import crypto from 'node:crypto';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { config } from '../../config/env.js';
import { db } from '../../db/client.js';
import {
  conversationMembers, conversations, groupInvitations, messages, notifications, outboxEvents, users,
  type Conversation, type GroupInvitation, type Message, type User,
} from '../../db/schema.js';
import { withUserPairLock, type Tx } from '../users/userPairLock.js';
import { findById, resolveDisplayName, toSocialUser, type SocialUser } from '../users/users.js';
import { getFriendship } from '../friendships/friendshipsRepository.js';
import { isBlockedEitherWay } from '../blocks/blocksRepository.js';
import { markNotificationsRead } from '../notifications/notificationsRepository.js';
import { countGroupMemberships, exceedsLimit, limitMax } from '../limits/limits.js';
import { SOCIAL_PAGE_SIZE, decodeTimeCursor, encodeTimeCursor, escapeLike } from '../friendships/cursor.js';
import { notifySocialChanged, onSocialChange, refreshKnownPeers } from '../presence/knownPeers.js';
import {
  broadcastToConversationMembers, canManageGroup, getOrCreateDirect, sendConversationUpdateToMembers, touchConversation,
} from './conversationsRepository.js';
import { loadInvitationCards, type InvitationCard } from './invitationCards.js';
import { logger } from '../../lib/logger.js';

const log = logger.child({ component: 'invitations' });

// Group invitations (docs/plano-rede-social.md §5.5, §5.6, §6.2, §7.2). An
// invitation is NOT membership: the only thing that ever creates a member
// here is acceptInvitation.
//
// LOCK ORDER — one order for every operation here, so none can deadlock:
//   1. the user-pair advisory lock (the same one friendships/blocks take)
//   2. the group row  (`for update`)
//   3. the invitation row  (`for update`)
// Accept reads the invitation UNLOCKED first, only to learn the pair and the
// group. Transferring ownership locks the group before touching invitations
// (conversations.ts).

export type InviteOutcome = 'sent' | 'already_pending' | 'already_member' | 'not_friends' | 'group_full' | 'unavailable';
export interface InviteResult { userId: string; outcome: InviteOutcome; invitationId?: string }

// distributes over the union so `code` stays a real discriminant
type Code<T extends string> = T extends string ? { code: T } : never;

export type InvitationAction =
  | { code: 'ok'; card: InvitationCard }
  | Code<'not_found' | 'forbidden' | 'invalid_state' | 'group_full' | 'quota_exceeded'>;

// ---- pure helpers (unit-tested) ---------------------------------------------

/** Deduplicates, drops non-strings and the inviter themself, and reports a
 * batch over the server-fixed cap instead of silently truncating it. */
export function normalizeInviteeIds(raw: unknown, inviterId: string): { ids: string[]; tooMany: boolean } {
  const list = Array.isArray(raw) ? raw : [];
  const ids = [...new Set(list.filter((v): v is string => typeof v === 'string' && v.length > 0 && v !== inviterId))];
  return { ids, tooMany: ids.length > config.MAX_INVITEES_PER_REQUEST };
}

// ---- locks ------------------------------------------------------------------

const lockGroup = (tx: Tx, id: string) => tx.execute(sql`select id from conversations where id = ${id} for update`);
const lockInvitation = (tx: Tx, id: string) => tx.execute(sql`select id from group_invitations where id = ${id} for update`);

// ---- events -----------------------------------------------------------------

/** The card as a chat message. Built here (not through messages.ts) because
 * messages.ts consumes this module's leaf pieces — importing it back would
 * make a cycle; the shape is the same one `rowToMessage` produces. */
function cardMessagePayload(message: Message, inviter: User, card: InvitationCard | null) {
  return {
    msgId: message.id, conversationId: message.conversationId, id: inviter.id,
    name: resolveDisplayName(inviter.displayName, inviter.username), avatar: inviter.avatar,
    text: '', ts: message.createdAt.getTime(), kind: 'group_invite' as const, invitation: card,
  };
}

/** Pushes the current state of these invitations to whoever is looking at
 * their card — the two members of the DM the card lives in. Never throws: it
 * runs after the change committed. */
export async function broadcastInvitationUpdates(invitationIds: string[]): Promise<void> {
  if (!invitationIds.length) return;
  try {
    const [cards, cardMessages] = await Promise.all([
      loadInvitationCards(invitationIds),
      db.select({ invitationId: messages.groupInvitationId, conversationId: messages.conversationId })
        .from(messages).where(inArray(messages.groupInvitationId, invitationIds)),
    ]);
    for (const row of cardMessages) {
      const card = row.invitationId ? cards.get(row.invitationId) : undefined;
      if (card) await broadcastToConversationMembers(row.conversationId, { t: 'invitation-updated', invitation: card });
    }
  } catch (err) {
    log.error('failed to broadcast card updates', err);
  }
}

async function recordInvitationEvent(tx: Tx, invitation: GroupInvitation): Promise<void> {
  await tx.insert(notifications).values({
    id: crypto.randomUUID(), recipientId: invitation.inviteeId, kind: 'group_invitation',
    groupInvitationId: invitation.id, dedupeKey: `group_invitation:${invitation.id}:${invitation.version}`,
  }).onConflictDoNothing();
  await tx.insert(outboxEvents).values({
    id: crypto.randomUUID(), type: 'group_invitation_created', audienceUserId: invitation.inviteeId,
    payload: { invitationId: invitation.id },
  });
}

// ---- create -----------------------------------------------------------------

interface SentCard { invitation: GroupInvitation; message: Message; dm: Conversation }

/** One invitee, in its own transaction — a failure for one person never takes
 * the rest of the batch down (per-recipient results, §5.5). */
async function inviteOne(inviterId: string, conversationId: string, inviteeId: string): Promise<{ result: InviteResult; sent?: SentCard }> {
  const unavailable: InviteResult = { userId: inviteeId, outcome: 'unavailable' };
  if (!(await findById(inviteeId))) return { result: unavailable };
  try {
    return await withUserPairLock(inviterId, inviteeId, async (tx) => {
      await lockGroup(tx, conversationId);
      const [group] = await tx.select().from(conversations).where(eq(conversations.id, conversationId)).limit(1);
      if (!group || group.type !== 'group' || group.status !== 'active') return { result: unavailable };

      // authority is re-checked INSIDE the lock — the caller may have lost
      // ownership between the up-front check and here
      const [inviterMembership] = await tx.select({ role: conversationMembers.role }).from(conversationMembers)
        .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, inviterId))).limit(1);
      if (inviterMembership?.role !== 'owner') return { result: unavailable };

      // "not friends" and "blocked" read the same to the caller (§5.4)
      const friendship = await getFriendship(inviterId, inviteeId, tx);
      if (friendship?.status !== 'accepted' || (await isBlockedEitherWay(inviterId, inviteeId, tx))) {
        return { result: { userId: inviteeId, outcome: 'not_friends' } };
      }

      const memberRows = await tx.select({ userId: conversationMembers.userId }).from(conversationMembers)
        .where(eq(conversationMembers.conversationId, conversationId));
      if (memberRows.some((m) => m.userId === inviteeId)) return { result: { userId: inviteeId, outcome: 'already_member' } };
      if (memberRows.length >= config.MAX_GROUP_MEMBERS) return { result: { userId: inviteeId, outcome: 'group_full' } };

      // a declined, revoked or legacy-expired invite can be sent again right
      // away; only a still-pending one blocks (the partial unique index agrees)
      const [pending] = await tx.select({ id: groupInvitations.id }).from(groupInvitations)
        .where(and(eq(groupInvitations.conversationId, conversationId), eq(groupInvitations.inviteeId, inviteeId), eq(groupInvitations.status, 'pending')))
        .limit(1);
      if (pending) return { result: { userId: inviteeId, outcome: 'already_pending', invitationId: pending.id } };

      const [invitation] = await tx.insert(groupInvitations).values({
        id: crypto.randomUUID(), conversationId, inviterId, inviteeId,
      }).returning();
      await recordInvitationEvent(tx, invitation!);

      const { conversation: dm } = await getOrCreateDirect(inviterId, inviteeId, inviterId, tx);
      const [message] = await tx.insert(messages).values({
        conversationId: dm.id, authorId: inviterId, text: '', kind: 'group_invite', groupInvitationId: invitation!.id,
      }).returning();
      return {
        result: { userId: inviteeId, outcome: 'sent', invitationId: invitation!.id },
        sent: { invitation: invitation!, message: message!, dm },
      };
    });
  } catch (err) {
    log.error('failed to invite', err, { inviteeId });
    return { result: unavailable };
  }
}

/** Everything that happens AFTER one card committed: the DM starts showing
 * for the invitee (touchConversation → conversation-updated, which their
 * client now inserts), the card arrives as a chat message, and both accounts
 * refetch their social lists. */
async function announceCard(inviter: User, sent: SentCard): Promise<void> {
  try {
    const card = (await loadInvitationCards([sent.invitation.id])).get(sent.invitation.id) ?? null;
    await touchConversation(sent.dm.id, sent.message.createdAt);
    await broadcastToConversationMembers(sent.dm.id, { t: 'chat', message: cardMessagePayload(sent.message, inviter, card) });
    await onSocialChange(inviter.id, sent.invitation.inviteeId);
  } catch (err) {
    log.error('failed to announce a card', err);
  }
}

/** Invites friends of the group's CURRENT owner. Validates authority once up
 * front, then issues each invitation independently. */
export async function createInvitations(
  inviterId: string, conversationId: string, rawInviteeIds: unknown,
): Promise<{ results: InviteResult[] } | { error: 'not_found' | 'forbidden' | 'too_many' }> {
  const [group] = await db.select({ type: conversations.type, status: conversations.status }).from(conversations).where(eq(conversations.id, conversationId)).limit(1);
  if (!group || group.type !== 'group' || group.status !== 'active') return { error: 'not_found' };
  if (!(await canManageGroup(conversationId, inviterId))) return { error: 'forbidden' };
  const { ids, tooMany } = normalizeInviteeIds(rawInviteeIds, inviterId);
  if (tooMany) return { error: 'too_many' };

  const inviter = await findById(inviterId);
  if (!inviter) return { error: 'forbidden' };
  const results: InviteResult[] = [];
  for (const inviteeId of ids) {
    const { result, sent } = await inviteOne(inviterId, conversationId, inviteeId);
    results.push(result);
    if (sent) await announceCard(inviter, sent);
  }
  return { results };
}

// ---- respond ----------------------------------------------------------------

async function cardOf(id: string): Promise<InvitationCard | null> {
  return (await loadInvitationCards([id])).get(id) ?? null;
}

/** Shared skeleton of accept/decline/revoke: read the invitation unlocked
 * (only to learn the pair and the group), then take the locks in the global
 * order and re-read it under the lock. */
async function withInvitationLocks<T>(
  id: string,
  authorize: (pre: GroupInvitation) => boolean,
  body: (tx: Tx, invitation: GroupInvitation, group: Conversation) => Promise<T>,
): Promise<T | Code<'not_found'>> {
  const [pre] = await db.select().from(groupInvitations).where(eq(groupInvitations.id, id)).limit(1);
  if (!pre || !authorize(pre)) return { code: 'not_found' };
  return withUserPairLock(pre.inviterId, pre.inviteeId, async (tx) => {
    await lockGroup(tx, pre.conversationId);
    await lockInvitation(tx, id);
    const [invitation] = await tx.select().from(groupInvitations).where(eq(groupInvitations.id, id)).limit(1);
    const [group] = await tx.select().from(conversations).where(eq(conversations.id, pre.conversationId)).limit(1);
    // the group (and with it the invitation) can be deleted between the
    // unlocked read and the locks
    if (!invitation || !group) return { code: 'not_found' as const };
    return body(tx, invitation, group);
  });
}

const markStatus = async (tx: Tx, id: string, status: 'accepted' | 'declined' | 'revoked') => {
  await tx.update(groupInvitations)
    .set({ status, respondedAt: new Date(), version: sql`${groupInvitations.version} + 1` })
    .where(eq(groupInvitations.id, id));
  await markNotificationsRead(tx, { invitationIds: [id] });
};

/** The one path that creates a member. Re-validates EVERYTHING under the
 * locks — validity, authority of the inviter, friendship, blocks, existing
 * membership, capacity — because any of it can have changed since the card
 * was sent. Idempotent: a second tab accepting just gets the current state. */
export async function acceptInvitation(inviteeId: string, id: string): Promise<InvitationAction> {
  let announce: { conversation: Conversation; memberIds: string[]; inviterId: string; revoked: boolean } | null = null;

  const outcome = await withInvitationLocks<Code<'ok' | 'invalid_state' | 'group_full' | 'quota_exceeded'>>(
    id,
    (pre) => pre.inviteeId === inviteeId,
    async (tx, invitation, group) => {
      const memberRows = await tx.select({ userId: conversationMembers.userId, role: conversationMembers.role })
        .from(conversationMembers).where(eq(conversationMembers.conversationId, group.id));
      const alreadyMember = memberRows.some((m) => m.userId === inviteeId);

      if (invitation.status === 'accepted') return { code: 'ok' as const };
      if (invitation.status !== 'pending') return { code: 'invalid_state' as const };

      const inviterIsOwner = memberRows.some((m) => m.userId === invitation.inviterId && m.role === 'owner');
      const friendship = await getFriendship(invitation.inviterId, inviteeId, tx);
      const stillAllowed = group.type === 'group' && group.status === 'active' && inviterIsOwner && friendship?.status === 'accepted'
        && !(await isBlockedEitherWay(invitation.inviterId, inviteeId, tx));
      if (!stillAllowed) {
        // never leave a pending invitation that can no longer be honored
        await markStatus(tx, id, 'revoked');
        announce = { conversation: group, memberIds: [], inviterId: invitation.inviterId, revoked: true };
        return { code: 'invalid_state' as const };
      }
      if (!alreadyMember && memberRows.length >= config.MAX_GROUP_MEMBERS) return { code: 'group_full' as const };
      // the invitee's OWN limit on how many groups they can belong to
      if (!alreadyMember && exceedsLimit(await countGroupMemberships(inviteeId, tx), limitMax('groupMemberships'))) return { code: 'quota_exceeded' as const };

      await tx.insert(conversationMembers).values({ conversationId: group.id, userId: inviteeId, role: 'member' }).onConflictDoNothing();
      await markStatus(tx, id, 'accepted');
      announce = {
        conversation: group, inviterId: invitation.inviterId, revoked: false,
        memberIds: alreadyMember ? memberRows.map((m) => m.userId) : [...memberRows.map((m) => m.userId), inviteeId],
      };
      return { code: 'ok' as const };
    },
  );

  const a = announce as { conversation: Conversation; memberIds: string[]; inviterId: string; revoked: boolean } | null;
  if (a) {
    if (a.revoked) {
      await broadcastInvitationUpdates([id]);
      notifySocialChanged([a.inviterId, inviteeId]);
    } else {
      // memberIds in the summary update every existing member's list; a
      // conversation the new member doesn't have yet is INSERTED by their client
      await sendConversationUpdateToMembers('conversation-updated', a.conversation);
      await refreshKnownPeers(a.memberIds);
      await broadcastInvitationUpdates([id]);
      notifySocialChanged([a.inviterId, inviteeId]);
    }
  }
  if (outcome.code === 'ok') {
    const card = await cardOf(id);
    return card ? { code: 'ok', card } : { code: 'not_found' };
  }
  return outcome;
}

/** The recipient turns it down. Deliberately NOT announced to the inviter as
 * a rejection (§5.3) — the card just shows the new state. */
export async function declineInvitation(inviteeId: string, id: string): Promise<InvitationAction> {
  let changed = false;
  let inviterId = '';
  const outcome = await withInvitationLocks<Code<'ok' | 'invalid_state'>>(
    id,
    (pre) => pre.inviteeId === inviteeId,
    async (tx, invitation) => {
      inviterId = invitation.inviterId;
      if (invitation.status === 'declined') return { code: 'ok' as const };
      if (invitation.status !== 'pending') return { code: 'invalid_state' as const };
      await markStatus(tx, id, 'declined');
      changed = true;
      return { code: 'ok' as const };
    },
  );
  if (changed) {
    await broadcastInvitationUpdates([id]);
    notifySocialChanged([inviterId, inviteeId]);
  }
  if (outcome.code === 'ok') {
    const card = await cardOf(id);
    return card ? { code: 'ok', card } : { code: 'not_found' };
  }
  return outcome;
}

/** Only the group's CURRENT owner revokes — whoever originally sent it. */
export async function revokeInvitation(actorId: string, id: string): Promise<InvitationAction> {
  let changed = false;
  let inviteeId = '';
  const outcome = await withInvitationLocks<Code<'ok' | 'forbidden' | 'invalid_state'>>(
    id,
    () => true,
    async (tx, invitation, group) => {
      inviteeId = invitation.inviteeId;
      const [role] = await tx.select({ role: conversationMembers.role }).from(conversationMembers)
        .where(and(eq(conversationMembers.conversationId, group.id), eq(conversationMembers.userId, actorId))).limit(1);
      if (role?.role !== 'owner') return { code: 'forbidden' as const };
      if (invitation.status === 'revoked') return { code: 'ok' as const };
      if (invitation.status !== 'pending') return { code: 'invalid_state' as const };
      await markStatus(tx, id, 'revoked');
      changed = true;
      return { code: 'ok' as const };
    },
  );
  if (changed) {
    await broadcastInvitationUpdates([id]);
    notifySocialChanged([actorId, inviteeId]);
  }
  if (outcome.code === 'ok') {
    const card = await cardOf(id);
    return card ? { code: 'ok', card } : { code: 'not_found' };
  }
  return outcome;
}

/** Deleting the card message takes the invitation back, so the chat and the
 * invitation can never disagree about whether the person may still join. Only a
 * PENDING invitation is affected: someone who already accepted stays a member.
 * The card itself is not broadcast — its message is about to be deleted. */
export async function revokeInvitationForDeletedCard(id: string): Promise<void> {
  let parties: [string, string] | null = null;
  await withInvitationLocks<Code<'ok'>>(id, () => true, async (tx, invitation) => {
    if (invitation.status !== 'pending') return { code: 'ok' as const };
    await markStatus(tx, id, 'revoked');
    parties = [invitation.inviterId, invitation.inviteeId];
    return { code: 'ok' as const };
  });
  if (parties) notifySocialChanged(parties);
}

/** Pushes the card update and the list-refresh signal for ids that were
 * revoked inside someone else's transaction (block, unfriend, ownership
 * transfer) — those callers get the ids back from invitationRevocation.ts. */
export async function announceRevocations(ids: string[]): Promise<void> {
  if (!ids.length) return;
  await broadcastInvitationUpdates(ids);
  const rows = await db.select({ inviterId: groupInvitations.inviterId, inviteeId: groupInvitations.inviteeId })
    .from(groupInvitations).where(inArray(groupInvitations.id, ids));
  for (const r of rows) notifySocialChanged([r.inviterId, r.inviteeId]);
}

// ---- lists ------------------------------------------------------------------

const microsecondIso = sql<string>`to_char(${groupInvitations.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

export interface ReceivedInvitationEntry {
  id: string;
  at: string;
  group: { id: string; title: string; avatar: string; memberCount: number };
  inviter: SocialUser;
}

export interface SentInvitationEntry { id: string; at: string; invitee: SocialUser }

/** The caller's pending invitations, newest first. `q` matches the group's name or the
 * inviter's name/username — only among invitations this account already has. */
export async function listReceivedInvitations(userId: string, cursorRaw?: string, q?: string): Promise<{ items: ReceivedInvitationEntry[]; nextCursor: string | null } | 'invalid_cursor'> {
  const cursor = cursorRaw ? decodeTimeCursor(cursorRaw) : null;
  if (cursorRaw && !cursor) return 'invalid_cursor';
  const pattern = q ? `%${escapeLike(q)}%` : null;
  const rows = await db
    .select({
      id: groupInvitations.id, ts: microsecondIso,
      groupId: conversations.id, groupTitle: conversations.title, groupAvatar: conversations.avatar,
      memberCount: sql<number>`(select count(*)::int from conversation_members m where m.conversation_id = ${conversations.id})`,
      inviter: users,
    })
    .from(groupInvitations)
    .innerJoin(conversations, eq(conversations.id, groupInvitations.conversationId))
    .innerJoin(users, eq(users.id, groupInvitations.inviterId))
    .where(and(
      eq(groupInvitations.inviteeId, userId),
      eq(groupInvitations.status, 'pending'),
      pattern ? sql`(lower(${conversations.title}) like ${pattern} or lower(${users.username}) like ${pattern} or lower(${users.displayName}) like ${pattern})` : undefined,
      cursor ? sql`(${groupInvitations.createdAt}, ${groupInvitations.id}) < (${cursor.ts}::timestamptz, ${cursor.id})` : undefined,
    ))
    .orderBy(desc(groupInvitations.createdAt), desc(groupInvitations.id))
    .limit(SOCIAL_PAGE_SIZE + 1);
  const page = rows.slice(0, SOCIAL_PAGE_SIZE);
  const last = page[page.length - 1];
  return {
    items: page.map((r) => ({
      id: r.id, at: r.ts,
      group: { id: r.groupId, title: r.groupTitle, avatar: r.groupAvatar, memberCount: r.memberCount },
      inviter: toSocialUser(r.inviter),
    })),
    nextCursor: rows.length > SOCIAL_PAGE_SIZE && last ? encodeTimeCursor(last.ts, last.id) : null,
  };
}

/** Pending invitations SENT for one group — owner only. */
export async function listGroupInvitations(ownerId: string, conversationId: string, cursorRaw?: string): Promise<{ items: SentInvitationEntry[]; nextCursor: string | null } | 'invalid_cursor' | 'forbidden'> {
  if (!(await canManageGroup(conversationId, ownerId))) return 'forbidden';
  const cursor = cursorRaw ? decodeTimeCursor(cursorRaw) : null;
  if (cursorRaw && !cursor) return 'invalid_cursor';
  const rows = await db
    .select({ id: groupInvitations.id, ts: microsecondIso, invitee: users })
    .from(groupInvitations)
    .innerJoin(users, eq(users.id, groupInvitations.inviteeId))
    .where(and(
      eq(groupInvitations.conversationId, conversationId),
      eq(groupInvitations.status, 'pending'),
      cursor ? sql`(${groupInvitations.createdAt}, ${groupInvitations.id}) < (${cursor.ts}::timestamptz, ${cursor.id})` : undefined,
    ))
    .orderBy(desc(groupInvitations.createdAt), desc(groupInvitations.id))
    .limit(SOCIAL_PAGE_SIZE + 1);
  const page = rows.slice(0, SOCIAL_PAGE_SIZE);
  const last = page[page.length - 1];
  return {
    items: page.map((r) => ({ id: r.id, at: r.ts, invitee: toSocialUser(r.invitee) })),
    nextCursor: rows.length > SOCIAL_PAGE_SIZE && last ? encodeTimeCursor(last.ts, last.id) : null,
  };
}

export async function countReceivedInvitations(userId: string): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(groupInvitations)
    .where(and(eq(groupInvitations.inviteeId, userId), eq(groupInvitations.status, 'pending')));
  return row?.n ?? 0;
}

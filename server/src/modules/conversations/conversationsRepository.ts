import crypto from 'node:crypto';
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { conversationMembers, conversations, users, type Conversation } from '../../db/schema.js';
import { participants, send } from '../presence/participants.js';
import { resolveDisplayName } from '../users/users.js';
import { deleteForConversation } from '../attachments/attachmentCleanup.js';
import type { Tx } from '../users/userPairLock.js';

// The conversations API other modules actually depend on (messages.ts,
// moderation.ts, attachmentServing.ts, attachmentUploads.ts) — as opposed
// to the socket handlers for conversation/group actions themselves
// (direct-open, group-create, etc.), which live in conversations.ts and
// are never imported individually, only dispatched as a block via
// `handlers`. See conversations.ts's own module comment for the handler
// half of this split.

export type ConversationType = 'direct' | 'group';
// 'admin' was never actually assigned anywhere in practice — dropped from
// the type along with the DB comment (see schema.ts#conversationMembers).
export type ConversationRole = 'owner' | 'member';

export interface ConversationSummary {
  id: string;
  type: ConversationType;
  title: string;
  avatar: string;
  createdBy: string | null;
  memberIds: string[];
  lastMessageAt: number | null;
  createdAt: number;
  updatedAt: number;
  pinnedAt: number | null;
  // the VIEWER's own role in this conversation — always 'member' for a DM
  // (DMs have no owner). Lets the frontend gate group-management UI on real
  // per-group ownership instead of the account's global instance role.
  myRole: ConversationRole;
  // derived from the owner's membership row, never stored twice (§6.3);
  // null for a DM. `memberIds` stays for presence/mentions until etapa 14.
  ownerId: string | null;
  memberCount: number;
  // 'suspended' = moderated away by an admin: still listed, no access
  status: 'active' | 'suspended';
}

export function sanitizeConversationTitle(name: unknown): string | null {
  const s = String(name == null ? '' : name).replace(/[\r\n\t]+/g, ' ').trim().slice(0, 80);
  return s || null;
}

function normalizeConversationType(type: string): ConversationType {
  return type === 'group' ? 'group' : 'direct';
}

// Exported (not just used by listForUser below) because conversations.ts's
// own handlers (handleDirectOpen, handleGroupCreate, handleGroupMembersAdd)
// build the same summary shape for the conversation they just acted on.
export function rowToSummary(row: Conversation, memberIds: string[], pinnedAt: Date | null, myRole: ConversationRole, ownerId: string | null): ConversationSummary {
  return {
    id: row.id,
    type: normalizeConversationType(row.type),
    title: row.title,
    avatar: row.avatar,
    createdBy: row.createdBy,
    memberIds,
    lastMessageAt: row.lastMessageAt ? row.lastMessageAt.getTime() : null,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
    pinnedAt: pinnedAt ? pinnedAt.getTime() : null,
    myRole,
    ownerId,
    memberCount: memberIds.length,
    status: row.status === 'suspended' ? 'suspended' : 'active',
  };
}

export async function listForUser(userId: string): Promise<ConversationSummary[]> {
  const rows = await db
    .select({ conversation: conversations, pinnedAt: conversationMembers.pinnedAt, role: conversationMembers.role })
    .from(conversationMembers)
    .innerJoin(conversations, eq(conversations.id, conversationMembers.conversationId))
    .where(and(
      eq(conversationMembers.userId, userId),
      // groups always show. A direct conversation only counts as "history"
      // once it has a message — opening a DM (handleDirectOpen) creates the
      // row right away so both sides can chat, but that alone shouldn't
      // plant it in anyone's sidebar. The same clause covers "closed"
      // conversations (member.hiddenAt set): hidden until a message newer
      // than the close time arrives, then it reappears on its own.
      or(
        eq(conversations.type, 'group'),
        and(
          sql`${conversations.lastMessageAt} is not null`,
          or(
            sql`${conversationMembers.hiddenAt} is null`,
            sql`${conversations.lastMessageAt} > ${conversationMembers.hiddenAt}`
          )
        )
      )
    ))
    // pinned conversations first (most recently pinned first among those),
    // then everyone else by the usual recency rule. Deliberately
    // lastMessageAt (not updatedAt/lastActivityAt) — a rename or a message
    // edit/delete must not resort the sidebar, only a genuinely NEW message
    // does (see schema.ts#conversations and touchConversation below).
    .orderBy(
      desc(sql`${conversationMembers.pinnedAt} is not null`),
      desc(conversationMembers.pinnedAt),
      desc(sql`coalesce(${conversations.lastMessageAt}, ${conversations.createdAt})`)
    );

  const ids = rows.map((r) => r.conversation.id);
  const members = new Map<string, string[]>();
  const owners = new Map<string, string>();
  if (ids.length) {
    const memberRows = await db.select().from(conversationMembers).where(inArray(conversationMembers.conversationId, ids));
    for (const row of memberRows) {
      const list = members.get(row.conversationId) ?? [];
      list.push(row.userId);
      members.set(row.conversationId, list);
      if (row.role === 'owner') owners.set(row.conversationId, row.userId);
    }
  }

  return rows.map((r) => rowToSummary(r.conversation, members.get(r.conversation.id) ?? [], r.pinnedAt, r.role as ConversationRole, owners.get(r.conversation.id) ?? null));
}

/** Sends the CURRENT state of one conversation to every member who already
 * has it, each seeing their OWN `pinnedAt` (a per-member column — a shared
 * payload would incorrectly reset another member's pin state on their
 * client, which does a wholesale replace-by-id, not a field merge). One
 * query for the member list, reused both for `memberIds` and each
 * recipient's pin — this is what replaced resending every OTHER
 * conversation in the sidebar (the old `broadcastConversationListToUser(s)`
 * + `listForUser`) just to reflect a change to ONE row. Exported because
 * conversations.ts's handleGroupUpdate calls this too, after renaming or
 * re-avataring a group. */
export async function sendConversationUpdateToMembers(t: 'conversation-created' | 'conversation-updated', row: Conversation): Promise<void> {
  const memberRows = await db.select({ userId: conversationMembers.userId, pinnedAt: conversationMembers.pinnedAt, role: conversationMembers.role })
    .from(conversationMembers).where(eq(conversationMembers.conversationId, row.id));
  const memberIds = memberRows.map((r) => r.userId);
  const ownerId = memberRows.find((r) => r.role === 'owner')?.userId ?? null;
  for (const { userId, pinnedAt, role } of memberRows) {
    for (const p of participants.values()) {
      if (p.userId === userId) send(p.socket, { t, conversation: rowToSummary(row, memberIds, pinnedAt, role as ConversationRole, ownerId) });
    }
  }
}

export async function broadcastToConversationMembers(conversationId: string, obj: { t: string; [key: string]: unknown }): Promise<void> {
  const memberRows = await db.select({ userId: conversationMembers.userId }).from(conversationMembers).where(eq(conversationMembers.conversationId, conversationId));
  const allowed = new Set(memberRows.map((row) => row.userId));
  for (const p of participants.values()) {
    if (allowed.has(p.userId)) send(p.socket, obj);
  }
}

export function dmKeyFor(a: string, b: string): string {
  return [a, b].sort().join(':');
}

/** Finds or creates the direct conversation between two accounts —
 * idempotent under concurrency. The old "select, then insert" would throw on
 * the unique `dm_key` index when two requests raced (and roll the whole
 * transaction back); `ON CONFLICT DO NOTHING` makes the loser wait for the
 * winner's commit and then just read its row. Pass a `tx` to join a caller's
 * transaction (an invitation card is created together with its invitation). */
export async function getOrCreateDirect(a: string, b: string, creatorId: string, executor?: Tx): Promise<{ conversation: Conversation; created: boolean }> {
  const run = async (tx: Tx) => {
    const dmKey = dmKeyFor(a, b);
    const [inserted] = await tx.insert(conversations).values({
      id: crypto.randomUUID(), type: 'direct', title: '', createdBy: creatorId, dmKey, updatedAt: new Date(),
    }).onConflictDoNothing({ target: conversations.dmKey }).returning();
    const conversation = inserted ?? (await tx.select().from(conversations).where(eq(conversations.dmKey, dmKey)).limit(1))[0]!;
    await tx.insert(conversationMembers).values([
      { conversationId: conversation.id, userId: a, role: 'member' },
      { conversationId: conversation.id, userId: b, role: 'member' },
    ]).onConflictDoNothing();
    return { conversation, created: !!inserted };
  };
  return executor ? run(executor) : db.transaction(run);
}

/** A group with its creator as the single `owner` member, in one
 * transaction — no path adds anyone else directly anymore (only an accepted
 * invitation does, see invitationsRepository.ts). */
export async function createGroup(ownerId: string, title: string): Promise<Conversation> {
  return db.transaction(async (tx) => {
    const [inserted] = await tx.insert(conversations).values({
      id: crypto.randomUUID(), type: 'group', title, createdBy: ownerId, updatedAt: new Date(),
    }).returning();
    await tx.insert(conversationMembers).values({ conversationId: inserted!.id, userId: ownerId, role: 'owner' });
    return inserted!;
  });
}

/** THE access gate: membership AND an active conversation. A suspended
 * conversation (admin moderation) is invisible to every read, write, media
 * fetch, search, upload and call token that goes through here — members still
 * see it listed (listForUser) but as unavailable. */
export async function getConversationForUser(conversationId: string, userId: string): Promise<Conversation | null> {
  const [row] = await db
    .select({ conversation: conversations })
    .from(conversationMembers)
    .innerJoin(conversations, eq(conversations.id, conversationMembers.conversationId))
    .where(and(
      eq(conversationMembers.conversationId, conversationId),
      eq(conversationMembers.userId, userId),
      eq(conversations.status, 'active'),
    ))
    .limit(1);
  return row?.conversation ?? null;
}

export async function conversationExistsForUser(conversationId: string, userId: string): Promise<boolean> {
  return !!(await getConversationForUser(conversationId, userId));
}

/** The other member of a DIRECT conversation — null if `userId` isn't a
 * member, or the conversation is a group (a group has no single "peer",
 * and contact restrictions never apply to it — membership already governs
 * that). Used by the direct-message write-path gates (canSendDirectMessage)
 * in messages.ts/socket.ts/attachmentUploads.ts. */
export async function getDirectPeerId(conversationId: string, userId: string): Promise<string | null> {
  const conversation = await getConversationForUser(conversationId, userId);
  if (!conversation || conversation.type !== 'direct') return null;
  const [other] = await db
    .select({ userId: conversationMembers.userId })
    .from(conversationMembers)
    .where(and(eq(conversationMembers.conversationId, conversationId), sql`${conversationMembers.userId} <> ${userId}`))
    .limit(1);
  return other?.userId ?? null;
}

/** Every OTHER account this user shares at least one conversation with
 * (DM or group), deduplicated — used to compute the "known peers"
 * presence-scoping set (realtime/socket.ts). */
export async function listConversationMemberIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: conversationMembers.userId })
    .from(conversationMembers)
    .where(and(
      sql`${conversationMembers.conversationId} IN (
        select ${conversationMembers.conversationId} from ${conversationMembers} where ${conversationMembers.userId} = ${userId}
      )`,
      sql`${conversationMembers.userId} <> ${userId}`,
    ));
  return [...new Set(rows.map((r) => r.userId))];
}

/** Whether `a` and `b` are both members of at least one conversation —
 * used only by usersRoutes.ts's profile-visibility check (a pairwise
 * question, unlike listConversationMemberIds' bulk one above). */
export async function shareAnyConversation(a: string, b: string): Promise<boolean> {
  const [row] = await db
    .select({ conversationId: conversationMembers.conversationId })
    .from(conversationMembers)
    .where(and(
      eq(conversationMembers.userId, a),
      sql`${conversationMembers.conversationId} IN (
        select ${conversationMembers.conversationId} from ${conversationMembers} where ${conversationMembers.userId} = ${b}
      )`,
    ))
    .limit(1);
  return !!row;
}

export async function getMemberRole(conversationId: string, userId: string): Promise<ConversationRole | null> {
  const [row] = await db.select({ role: conversationMembers.role })
    .from(conversationMembers)
    .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, userId)))
    .limit(1);
  return row ? (row.role as ConversationRole) : null;
}

/** Real per-group authority to manage a group (rename, re-avatar, add/remove
 * members, delete) — the group's actual `owner`, not the account's global
 * instance role. Replaces the old `isAdmin(p)` gate in conversations.ts,
 * which let ANY instance admin manage ANY group regardless of membership. */
export async function canManageGroup(conversationId: string, userId: string): Promise<boolean> {
  const [row] = await db.select({ role: conversationMembers.role })
    .from(conversationMembers)
    .innerJoin(conversations, eq(conversations.id, conversationMembers.conversationId))
    .where(and(
      eq(conversationMembers.conversationId, conversationId),
      eq(conversationMembers.userId, userId),
      eq(conversations.status, 'active'),
    ))
    .limit(1);
  return row?.role === 'owner';
}

/** A genuinely NEW message was created (send, or a fresh attachment-only
 * message) — the only thing that should move a conversation to the top of
 * anyone's sidebar or make an otherwise-empty/closed direct conversation
 * start showing (see listForUser's `lastMessageAt`-gated visibility rule
 * above). Broadcasts, since `lastMessageAt` is part of what the client
 * displays/sorts by. */
export async function touchConversation(conversationId: string, when = new Date()): Promise<void> {
  const [row] = await db.update(conversations).set({ lastMessageAt: when, lastActivityAt: when }).where(eq(conversations.id, conversationId)).returning();
  if (row) await sendConversationUpdateToMembers('conversation-updated', row);
}

/** A message was edited or deleted, or a file was attached to a message
 * that already exists — real chat activity, but NOT a new message, so
 * `lastMessageAt` must stay untouched (see touchConversation above for
 * why). Only bumps the bookkeeping-only `lastActivityAt` — nothing the
 * client displays changes, so there's nothing worth broadcasting either. */
export async function recordConversationActivity(conversationId: string, when = new Date()): Promise<void> {
  await db.update(conversations).set({ lastActivityAt: when }).where(eq(conversations.id, conversationId));
}

export async function conversationDisplayName(conversationId: string, viewerUserId: string): Promise<string> {
  const conversation = await getConversationForUser(conversationId, viewerUserId);
  if (!conversation) return 'conversa';
  if (conversation.type === 'group') return conversation.title || 'Grupo';

  const [other] = await db
    .select({ username: users.username, displayName: users.displayName })
    .from(conversationMembers)
    .innerJoin(users, eq(users.id, conversationMembers.userId))
    .where(and(eq(conversationMembers.conversationId, conversationId), sql`${conversationMembers.userId} <> ${viewerUserId}`))
    .limit(1);
  return other ? resolveDisplayName(other.displayName, other.username) : 'Conversa direta';
}

/** Purges a group once it has zero members left (an admin-account deletion
 * can do this too, not just handleGroupMembersRemove in conversations.ts —
 * with no group-discovery UI, a memberless group would otherwise become an
 * invisible, unmanageable row nobody's `listForUser` query ever surfaces
 * again). Otherwise just notifies whoever remains that `removedUserId` left.
 * Returns whether the group was purged. */
export async function reconcileGroupMembership(conversationId: string, removedUserId: string): Promise<boolean> {
  const remainingRows = await db.select({ userId: conversationMembers.userId }).from(conversationMembers).where(eq(conversationMembers.conversationId, conversationId));
  if (remainingRows.length > 0) {
    const remainingIds = new Set(remainingRows.map((row) => row.userId));
    for (const p of participants.values()) {
      if (remainingIds.has(p.userId)) send(p.socket, { t: 'conversation-member-removed', conversationId, userId: removedUserId });
    }
    return false;
  }
  const [conversation] = await db.select({ type: conversations.type }).from(conversations).where(eq(conversations.id, conversationId)).limit(1);
  if (conversation?.type !== 'group') return false;
  await deleteForConversation(conversationId);
  await db.delete(conversations).where(eq(conversations.id, conversationId));
  return true;
}

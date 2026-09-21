import { and, eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { conversationMembers, conversations, users } from '../../db/schema.js';
import { participants, send, sendToUser } from '../presence/participants.js';
import { refreshKnownPeers } from '../presence/knownPeers.js';
import { sanitizeAvatar } from '../profile/sanitize.js';
import { deleteAvatarFile, deleteForConversation } from '../attachments/attachmentCleanup.js';
import { ERROR_CODES } from '../../http/errors.js';
import {
  canManageGroup,
  conversationExistsForUser,
  createGroup,
  getOrCreateDirect,
  getConversationForUser,
  reconcileGroupMembership,
  rowToSummary,
  sanitizeConversationTitle,
  sendConversationUpdateToMembers,
} from './conversationsRepository.js';
import { createInvitations, announceRevocations } from './invitationsRepository.js';
import { removeMember, transferOwnership } from './groupMembership.js';
import { revokeCallAccess } from '../calls/callAccess.js';
import type { AppSocket, HandlerTable } from '../../types.js';

// The socket handlers for conversation/group actions (open a DM, create a
// group, rename it, add/remove members...) — never imported individually,
// only dispatched as a block via `handlers`. The repository API other
// modules actually depend on (listForUser, touchConversation, etc.) lives
// in conversationsRepository.ts; see that file's own module comment.

async function findUser(userId: string): Promise<boolean> {
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
  return !!row;
}

/** Creates the DM (or finds the existing one) and hands it straight to the
 * OPENER only — never broadcasts to the other side. `listForUser` won't
 * surface an empty (or closed) direct conversation, so without this the
 * opener's own client would have nothing to render for it either; sending
 * the summary directly lets them see/type into it for this session without
 * it being "real" history for anyone until an actual message is sent
 * (touchConversation already broadcasts to both sides at that point). */
async function handleDirectOpen(socket: AppSocket, msg: { userId?: string }): Promise<void> {
  const p = participants.get(socket.participantId ?? '');
  if (!p || p.socket !== socket) return;
  const otherUserId = String(msg.userId || '');
  if (!otherUserId || otherUserId === p.userId || !(await findUser(otherUserId))) return;

  const { conversation } = await getOrCreateDirect(p.userId, otherUserId, p.userId);

  send(socket, {
    t: 'conversation-opened',
    conversationId: conversation.id,
    conversation: rowToSummary(conversation, [p.userId, otherUserId], null, 'member', null),
  });
  // a peer this connection has never had in its known set (a brand-new DM,
  // or one that predates the connection) — without this the client gets a
  // conversation with a member whose profile it was never sent. Conditioned
  // on the set rather than on "was just created" so it also self-heals.
  if (!p.knownPeerIds.has(otherUserId)) await refreshKnownPeers([p.userId, otherUserId]);
}

/** Discord-style "Close DM" — drops it from the caller's OWN sidebar
 * without touching the conversation, its messages, or the other member's
 * membership row. `listForUser` re-surfaces it automatically once a message
 * newer than this arrives (from either side); reopening it before that
 * (handleDirectOpen) shows it again for this session without un-hiding it. */
async function handleConversationClose(socket: AppSocket, msg: { conversationId?: string }): Promise<void> {
  const p = participants.get(socket.participantId ?? '');
  if (!p || p.socket !== socket) return;
  const conversationId = String(msg.conversationId || '');
  if (!conversationId) return;
  const conversation = await getConversationForUser(conversationId, p.userId);
  if (!conversation || conversation.type !== 'direct') return;

  await db.update(conversationMembers)
    .set({ hiddenAt: new Date() })
    .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, p.userId)));
  // Same event the client already understands as "gone from my sidebar" —
  // closing a DM only ever affects the closer's own view (other tabs
  // included), never anyone else's.
  sendToUser(p.userId, { t: 'conversation-deleted', conversationId });
}

/** Per-member pin (direct or group) — a personal sort-to-top on the
 * caller's own sidebar, doesn't touch the conversation or anyone else's
 * row. Symmetric with handleConversationClose but not DM-only. */
async function handleConversationPin(socket: AppSocket, msg: { conversationId?: string; pinned?: boolean }): Promise<void> {
  const p = participants.get(socket.participantId ?? '');
  if (!p || p.socket !== socket) return;
  const conversationId = String(msg.conversationId || '');
  if (!conversationId) return;
  if (!(await conversationExistsForUser(conversationId, p.userId))) return;

  const [updated] = await db.update(conversationMembers)
    .set({ pinnedAt: msg.pinned ? new Date() : null })
    .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, p.userId)))
    .returning({ pinnedAt: conversationMembers.pinnedAt });
  sendToUser(p.userId, { t: 'conversation-pinned', conversationId, pinnedAt: updated?.pinnedAt ? updated.pinnedAt.getTime() : null });
}

// Any active account can create a group — creating one makes you its
// owner (canManageGroup, conversationsRepository.ts), same as everyone
// else's groups. No instance-role gate here at all.
//
// Nobody but the creator becomes a member here anymore (docs/plano-rede-social.md
// §4.2.10): `memberIds` from a client that still sends them (an old build, or a
// raw socket) are turned into INVITATIONS, and only accepting one creates a
// member. The current client creates groups over HTTP (POST /api/groups) and
// sees each invitation's result; this path stays for the ones that don't.
async function handleGroupCreate(socket: AppSocket, msg: { title?: string; memberIds?: unknown }): Promise<void> {
  const p = participants.get(socket.participantId ?? '');
  if (!p || p.socket !== socket) return;
  const title = sanitizeConversationTitle(msg.title);
  if (!title) return;

  const conversation = await createGroup(p.userId, title);
  send(socket, { t: 'conversation-opened', conversationId: conversation.id, conversation: rowToSummary(conversation, [p.userId], null, 'owner', p.userId) });
  if (Array.isArray(msg.memberIds) && msg.memberIds.length) {
    await createInvitations(p.userId, conversation.id, msg.memberIds);
  }
}

async function handleGroupDelete(socket: AppSocket, msg: { conversationId?: string }): Promise<void> {
  const p = participants.get(socket.participantId ?? '');
  if (!p || p.socket !== socket) return;
  const conversationId = String(msg.conversationId || '');
  if (!(await canManageGroup(conversationId, p.userId))) {
    send(socket, { t: 'error', code: ERROR_CODES.forbidden, message: 'Você não tem permissão para gerenciar esse grupo.' });
    return;
  }
  const [conversation] = await db.select().from(conversations).where(eq(conversations.id, conversationId)).limit(1);
  if (!conversation || conversation.type !== 'group') return;
  const memberRows = await db.select({ userId: conversationMembers.userId }).from(conversationMembers).where(eq(conversationMembers.conversationId, conversationId));
  await deleteForConversation(conversationId);
  await db.delete(conversations).where(eq(conversations.id, conversationId));
  for (const member of memberRows) {
    sendToUser(member.userId, { t: 'conversation-deleted', conversationId, reason: 'deleted' });
    void revokeCallAccess(member.userId, conversationId);
  }
  await refreshKnownPeers(memberRows.map((row) => row.userId));
}

/** Owner-only rename/re-avatar. `title` and `avatar` are each applied only
 * when present in the message, so one can change without touching the
 * other. Title validation mirrors handleGroupCreate; avatar validation
 * mirrors an account's own (see modules/profile/sanitize.ts#sanitizeAvatar) —
 * `avatar: ''` is a valid, deliberate "remove the photo". */
async function handleGroupUpdate(socket: AppSocket, msg: { conversationId?: string; title?: string; avatar?: string }): Promise<void> {
  const p = participants.get(socket.participantId ?? '');
  if (!p || p.socket !== socket) return;
  const conversationId = String(msg.conversationId || '');
  if (!conversationId) return;
  if (!(await canManageGroup(conversationId, p.userId))) {
    send(socket, { t: 'error', code: ERROR_CODES.forbidden, message: 'Você não tem permissão para gerenciar esse grupo.' });
    return;
  }
  const [conversation] = await db.select().from(conversations).where(eq(conversations.id, conversationId)).limit(1);
  if (!conversation || conversation.type !== 'group') return;

  const updates: { title?: string; avatar?: string; updatedAt: Date } = { updatedAt: new Date() };
  if (msg.title !== undefined) {
    const title = sanitizeConversationTitle(msg.title);
    if (title) updates.title = title;
  }
  if (msg.avatar !== undefined) updates.avatar = sanitizeAvatar(msg.avatar);
  if (updates.title === undefined && updates.avatar === undefined) return;

  const [updatedRow] = await db.update(conversations).set(updates).where(eq(conversations.id, conversationId)).returning();

  // the old file (if it was one of our uploads) is now orphaned — same
  // cleanup an account's own avatar change gets in handleProfile.
  if (updates.avatar !== undefined && conversation.avatar && conversation.avatar !== updates.avatar) {
    deleteAvatarFile(conversation.avatar).catch((err) => {
      console.error(`[conversations] failed to delete old avatar for group ${conversationId}:`, err instanceof Error ? err.stack : err);
    });
  }

  await sendConversationUpdateToMembers('conversation-updated', updatedRow!);
}

/** Adding a member directly is gone: joining a group takes the invitee's
 * acceptance (docs/plano-rede-social.md §4.2.10). Kept as a handler only so a
 * client that still sends this gets a clear refusal instead of silence —
 * nothing here writes to conversation_members. */
async function handleGroupMembersAdd(socket: AppSocket): Promise<void> {
  send(socket, { t: 'error', code: ERROR_CODES.forbidden, message: 'Convide amigos para o grupo — eles entram ao aceitar o convite.' });
}

/** Owner-only. Hands the group to an existing member and demotes the
 * caller, validated and applied under the group row lock (see
 * groupMembership.ts#transferOwnership). Reuses
 * sendConversationUpdateToMembers so every recipient gets their own
 * correct `myRole` (the new owner's flips to 'owner', everyone else's
 * summary is unaffected but resent for consistency). */
async function handleGroupTransferOwner(socket: AppSocket, msg: { conversationId?: string; userId?: string }): Promise<void> {
  const p = participants.get(socket.participantId ?? '');
  if (!p || p.socket !== socket) return;
  const conversationId = String(msg.conversationId || '');
  const newOwnerId = String(msg.userId || '');
  if (!conversationId || !newOwnerId || newOwnerId === p.userId) return;

  const result = await transferOwnership(conversationId, p.userId, newOwnerId);
  if (result.code === 'forbidden') {
    send(socket, { t: 'error', code: ERROR_CODES.forbidden, message: 'Você não tem permissão para gerenciar esse grupo.' });
    return;
  }
  if (result.code === 'not_member') {
    send(socket, { t: 'error', code: ERROR_CODES.notFound, message: 'Essa pessoa não é membro do grupo.' });
    return;
  }
  if (result.code !== 'ok') return;

  const [conversation] = await db.select().from(conversations).where(eq(conversations.id, conversationId)).limit(1);
  if (conversation) await sendConversationUpdateToMembers('conversation-updated', conversation);
  await announceRevocations(result.revokedInvitationIds);
}

/** The group's owner removes anyone; a member can only remove THEMSELVES
 * (leave). The owner leaving is only allowed once they're the LAST member —
 * otherwise they'd orphan the group. Transferring ownership first (see
 * handleGroupTransferOwner) clears the way. */
async function handleGroupMembersRemove(socket: AppSocket, msg: { conversationId?: string; userId?: string }): Promise<void> {
  const p = participants.get(socket.participantId ?? '');
  if (!p || p.socket !== socket) return;
  const conversationId = String(msg.conversationId || '');
  const targetUserId = String(msg.userId || '');
  if (!conversationId || !targetUserId) return;

  const result = await removeMember(conversationId, p.userId, targetUserId);
  if (result.code === 'forbidden') {
    send(socket, { t: 'error', code: ERROR_CODES.forbidden, message: 'Você não tem permissão para remover esse membro.' });
    return;
  }
  if (result.code === 'owner_must_transfer') {
    send(socket, { t: 'error', code: ERROR_CODES.conflict, message: 'Transfira a propriedade do grupo antes de sair.' });
    return;
  }
  if (result.code !== 'ok') return;

  // the removed account loses access immediately — from their client's POV
  // this is the same as the conversation disappearing (RoomProvider already
  // clears messages/unread and leaves an active call on 'conversation-deleted').
  // leaving on your own needs no notice; being removed does
  sendToUser(targetUserId, { t: 'conversation-deleted', conversationId, ...(targetUserId !== p.userId ? { reason: 'removed' } : {}) });
  // a client that ignores the event still gets cut off from the media itself
  void revokeCallAccess(targetUserId, conversationId);

  await reconcileGroupMembership(conversationId, targetUserId);
  await refreshKnownPeers([targetUserId, ...result.remainingIds]);
}

export const handlers: HandlerTable = {
  'direct-open': handleDirectOpen,
  'conversation-close': handleConversationClose,
  'conversation-pin': handleConversationPin,
  'group-create': handleGroupCreate,
  'group-delete': handleGroupDelete,
  'group-update': handleGroupUpdate,
  'group-members-add': handleGroupMembersAdd,
  'group-members-remove': handleGroupMembersRemove,
  'group-transfer-owner': handleGroupTransferOwner,
};

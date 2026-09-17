import crypto from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { conversationMembers, conversations, users } from '../../db/schema.js';
import { participants, send } from '../presence/participants.js';
import { sanitizeAvatar } from '../profile/sanitize.js';
import { deleteAvatarFile, deleteForConversation } from '../attachments/attachmentCleanup.js';
import {
  conversationExistsForUser,
  getConversationForUser,
  reconcileGroupMembership,
  rowToSummary,
  sanitizeConversationTitle,
  sendConversationUpdateToMembers,
} from './conversationsRepository.js';
import type { AppSocket, HandlerTable, Participant } from '../../types.js';

// The socket handlers for conversation/group actions (open a DM, create a
// group, rename it, add/remove members...) — never imported individually,
// only dispatched as a block via `handlers`. The repository API other
// modules actually depend on (listForUser, touchConversation, etc.) lives
// in conversationsRepository.ts; see that file's own module comment.

function isAdmin(p: Participant | undefined): boolean {
  return !!p && p.role === 'admin';
}

function dmKeyFor(a: string, b: string): string {
  return [a, b].sort().join(':');
}

/** Sends `obj` to every currently-connected socket belonging to `userId` —
 * multi-tab/device fan-out for events that are only ever visible to the
 * acting user themselves (closing a DM, pinning, marking as read). */
function sendToUser(userId: string, obj: { t: string; [key: string]: unknown }): void {
  for (const p of participants.values()) {
    if (p.userId === userId) send(p.socket, obj);
  }
}

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

  const dmKey = dmKeyFor(p.userId, otherUserId);
  const [existing] = await db.select().from(conversations).where(eq(conversations.dmKey, dmKey)).limit(1);
  let conversation = existing;
  if (!conversation) {
    const now = new Date();
    conversation = await db.transaction(async (tx) => {
      const [inserted] = await tx.insert(conversations).values({
        id: crypto.randomUUID(),
        type: 'direct',
        title: '',
        createdBy: p.userId,
        dmKey,
        updatedAt: now,
      }).returning();
      await tx.insert(conversationMembers).values([
        { conversationId: inserted!.id, userId: p.userId, role: 'member' },
        { conversationId: inserted!.id, userId: otherUserId, role: 'member' },
      ]);
      return inserted!;
    });
  }

  send(socket, {
    t: 'conversation-opened',
    conversationId: conversation.id,
    conversation: rowToSummary(conversation, [p.userId, otherUserId]),
  });
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

async function handleGroupCreate(socket: AppSocket, msg: { title?: string; memberIds?: unknown }): Promise<void> {
  const p = participants.get(socket.participantId ?? '');
  if (!p || p.socket !== socket || !isAdmin(p)) return;
  const title = sanitizeConversationTitle(msg.title);
  if (!title) return;

  const rawMemberIds = Array.isArray(msg.memberIds) ? msg.memberIds.map(String) : [];
  const requested = [...new Set([p.userId, ...rawMemberIds])];
  const existingUsers = await db.select({ id: users.id }).from(users).where(inArray(users.id, requested));
  const memberIds = existingUsers.map((row) => row.id);
  if (!memberIds.includes(p.userId)) memberIds.push(p.userId);

  const now = new Date();
  const [conversation] = await db.insert(conversations).values({
    id: crypto.randomUUID(),
    type: 'group',
    title,
    createdBy: p.userId,
    updatedAt: now,
  }).returning();
  await db.insert(conversationMembers).values(memberIds.map((userId) => ({
    conversationId: conversation!.id,
    userId,
    role: userId === p.userId ? 'owner' : 'member',
  })));

  // Creator gets 'conversation-opened' (adds it AND switches to it, same as
  // handleDirectOpen) with `conversation` populated — the other members
  // just get 'conversation-created' (adds it, doesn't switch anyone's view).
  // `pinnedAt: null` for everyone: a brand-new group can't already be pinned.
  const summary = rowToSummary(conversation!, memberIds, null);
  send(socket, { t: 'conversation-opened', conversationId: conversation!.id, conversation: summary });
  for (const userId of memberIds) {
    if (userId === p.userId) continue;
    sendToUser(userId, { t: 'conversation-created', conversation: summary });
  }
}

async function handleGroupDelete(socket: AppSocket, msg: { conversationId?: string }): Promise<void> {
  const p = participants.get(socket.participantId ?? '');
  if (!p || p.socket !== socket || !isAdmin(p)) return;
  const conversationId = String(msg.conversationId || '');
  const [conversation] = await db.select().from(conversations).where(eq(conversations.id, conversationId)).limit(1);
  if (!conversation || conversation.type !== 'group') return;
  const memberRows = await db.select({ userId: conversationMembers.userId }).from(conversationMembers).where(eq(conversationMembers.conversationId, conversationId));
  await deleteForConversation(conversationId);
  await db.delete(conversations).where(eq(conversations.id, conversationId));
  for (const participant of participants.values()) {
    if (participant.callConversationId === conversationId) participant.callConversationId = null;
  }
  for (const member of memberRows) {
    for (const participant of participants.values()) {
      if (participant.userId === member.userId) send(participant.socket, { t: 'conversation-deleted', conversationId });
    }
  }
}

/** Admin-only rename/re-avatar. `title` and `avatar` are each applied only
 * when present in the message, so one can change without touching the
 * other. Title validation mirrors handleGroupCreate; avatar validation
 * mirrors an account's own (see modules/profile/sanitize.ts#sanitizeAvatar) —
 * `avatar: ''` is a valid, deliberate "remove the photo". */
async function handleGroupUpdate(socket: AppSocket, msg: { conversationId?: string; title?: string; avatar?: string }): Promise<void> {
  const p = participants.get(socket.participantId ?? '');
  if (!p || p.socket !== socket || !isAdmin(p)) return;
  const conversationId = String(msg.conversationId || '');
  if (!conversationId) return;
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

/** Admin-only. Silently skips ids that don't exist or are already members —
 * matches handleGroupCreate's "just filter, don't error" approach. */
async function handleGroupMembersAdd(socket: AppSocket, msg: { conversationId?: string; memberIds?: unknown }): Promise<void> {
  const p = participants.get(socket.participantId ?? '');
  if (!p || p.socket !== socket || !isAdmin(p)) return;
  const conversationId = String(msg.conversationId || '');
  if (!conversationId) return;
  const [conversation] = await db.select().from(conversations).where(eq(conversations.id, conversationId)).limit(1);
  if (!conversation || conversation.type !== 'group') return;

  const rawMemberIds = Array.isArray(msg.memberIds) ? [...new Set(msg.memberIds.map(String))] : [];
  if (!rawMemberIds.length) return;
  const currentRows = await db.select({ userId: conversationMembers.userId }).from(conversationMembers).where(eq(conversationMembers.conversationId, conversationId));
  const currentIds = new Set(currentRows.map((row) => row.userId));
  const candidateIds = rawMemberIds.filter((id) => !currentIds.has(id));
  if (!candidateIds.length) return;
  const existingUsers = await db.select({ id: users.id }).from(users).where(inArray(users.id, candidateIds));
  const newIds = existingUsers.map((row) => row.id);
  if (!newIds.length) return;

  await db.insert(conversationMembers).values(newIds.map((userId) => ({ conversationId, userId, role: 'member' as const })));

  // Brand-new members have never seen this conversation — they need the
  // whole thing (pinnedAt: null, they can't have pinned it yet). Existing
  // members just need to know who joined, one event per new member.
  const allMemberIds = [...currentIds, ...newIds];
  const summary = rowToSummary(conversation, allMemberIds, null);
  for (const userId of newIds) sendToUser(userId, { t: 'conversation-created', conversation: summary });
  for (const newUserId of newIds) {
    for (const participant of participants.values()) {
      if (currentIds.has(participant.userId)) send(participant.socket, { t: 'conversation-member-added', conversationId, userId: newUserId });
    }
  }
}

/** Admin removes anyone; a member can only remove THEMSELVES (leave). */
async function handleGroupMembersRemove(socket: AppSocket, msg: { conversationId?: string; userId?: string }): Promise<void> {
  const p = participants.get(socket.participantId ?? '');
  if (!p || p.socket !== socket) return;
  const conversationId = String(msg.conversationId || '');
  const targetUserId = String(msg.userId || '');
  if (!conversationId || !targetUserId) return;
  const isSelf = targetUserId === p.userId;
  if (!isSelf && !isAdmin(p)) return;

  const [conversation] = await db.select().from(conversations).where(eq(conversations.id, conversationId)).limit(1);
  if (!conversation || conversation.type !== 'group') return;

  const deleted = await db.delete(conversationMembers)
    .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, targetUserId)))
    .returning({ userId: conversationMembers.userId });
  if (!deleted.length) return;

  // the removed account loses access immediately — from their client's POV
  // this is the same as the conversation disappearing (RoomProvider already
  // clears messages/unread and leaves an active call on 'conversation-deleted').
  for (const participant of participants.values()) {
    if (participant.userId !== targetUserId) continue;
    if (participant.callConversationId === conversationId) participant.callConversationId = null;
    send(participant.socket, { t: 'conversation-deleted', conversationId });
  }

  await reconcileGroupMembership(conversationId, targetUserId);
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
};

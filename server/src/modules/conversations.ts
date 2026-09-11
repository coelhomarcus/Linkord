import crypto from 'node:crypto';
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { conversationMembers, conversations, users, type Conversation } from '../db/schema.js';
import { participants, sanitizeAvatar, send } from '../realtime/participants.js';
import { resolveDisplayName } from './auth/users.js';
import type { AppSocket, HandlerTable, Participant } from '../types.js';

export type ConversationType = 'direct' | 'group';
export type ConversationRole = 'owner' | 'admin' | 'member';

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
}

function isAdmin(p: Participant | undefined): boolean {
  return !!p && p.role === 'admin';
}

export function sanitizeConversationTitle(name: unknown): string | null {
  const s = String(name == null ? '' : name).replace(/[\r\n\t]+/g, ' ').trim().slice(0, 80);
  return s || null;
}

function dmKeyFor(a: string, b: string): string {
  return [a, b].sort().join(':');
}

function normalizeConversationType(type: string): ConversationType {
  return type === 'group' ? 'group' : 'direct';
}

function rowToSummary(row: Conversation, memberIds: string[], pinnedAt: Date | null = null): ConversationSummary {
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
  };
}

export async function listForUser(userId: string): Promise<ConversationSummary[]> {
  const rows = await db
    .select({ conversation: conversations, pinnedAt: conversationMembers.pinnedAt })
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
    // then everyone else by the usual recency rule.
    .orderBy(
      desc(sql`${conversationMembers.pinnedAt} is not null`),
      desc(conversationMembers.pinnedAt),
      desc(sql`coalesce(${conversations.lastMessageAt}, ${conversations.updatedAt}, ${conversations.createdAt})`)
    );

  const ids = rows.map((r) => r.conversation.id);
  const members = new Map<string, string[]>();
  if (ids.length) {
    const memberRows = await db.select().from(conversationMembers).where(inArray(conversationMembers.conversationId, ids));
    for (const row of memberRows) {
      const list = members.get(row.conversationId) ?? [];
      list.push(row.userId);
      members.set(row.conversationId, list);
    }
  }

  return rows.map((r) => rowToSummary(r.conversation, members.get(r.conversation.id) ?? [], r.pinnedAt));
}

export async function broadcastConversationListToUser(userId: string): Promise<void> {
  const payload = await listForUser(userId);
  for (const p of participants.values()) {
    if (p.userId === userId) send(p.socket, { t: 'conversation-list', conversations: payload });
  }
}

async function broadcastConversationListToUsers(userIds: string[]): Promise<void> {
  await Promise.all([...new Set(userIds)].map((userId) => broadcastConversationListToUser(userId)));
}

export async function broadcastToConversationMembers(conversationId: string, obj: { t: string; [key: string]: unknown }): Promise<void> {
  const memberRows = await db.select({ userId: conversationMembers.userId }).from(conversationMembers).where(eq(conversationMembers.conversationId, conversationId));
  const allowed = new Set(memberRows.map((row) => row.userId));
  for (const p of participants.values()) {
    if (allowed.has(p.userId)) send(p.socket, obj);
  }
}

export async function getConversationForUser(conversationId: string, userId: string): Promise<Conversation | null> {
  const [row] = await db
    .select({ conversation: conversations })
    .from(conversationMembers)
    .innerJoin(conversations, eq(conversations.id, conversationMembers.conversationId))
    .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, userId)))
    .limit(1);
  return row?.conversation ?? null;
}

export async function conversationExistsForUser(conversationId: string, userId: string): Promise<boolean> {
  return !!(await getConversationForUser(conversationId, userId));
}

export async function touchConversation(conversationId: string, when = new Date()): Promise<void> {
  await db.update(conversations).set({ lastMessageAt: when, updatedAt: when }).where(eq(conversations.id, conversationId));
  const memberRows = await db.select({ userId: conversationMembers.userId }).from(conversationMembers).where(eq(conversationMembers.conversationId, conversationId));
  await broadcastConversationListToUsers(memberRows.map((row) => row.userId));
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
  await broadcastConversationListToUser(p.userId);
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

  await db.update(conversationMembers)
    .set({ pinnedAt: msg.pinned ? new Date() : null })
    .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, p.userId)));
  await broadcastConversationListToUser(p.userId);
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

  await broadcastConversationListToUsers(memberIds);
  send(socket, { t: 'conversation-opened', conversationId: conversation!.id });
}

async function handleGroupDelete(socket: AppSocket, msg: { conversationId?: string }): Promise<void> {
  const p = participants.get(socket.participantId ?? '');
  if (!p || p.socket !== socket || !isAdmin(p)) return;
  const conversationId = String(msg.conversationId || '');
  const [conversation] = await db.select().from(conversations).where(eq(conversations.id, conversationId)).limit(1);
  if (!conversation || conversation.type !== 'group') return;
  const memberRows = await db.select({ userId: conversationMembers.userId }).from(conversationMembers).where(eq(conversationMembers.conversationId, conversationId));
  const { deleteForConversation } = await import('./attachments.js');
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
  await broadcastConversationListToUsers(memberRows.map((row) => row.userId));
}

/** Admin-only rename/re-avatar. `title` and `avatar` are each applied only
 * when present in the message, so one can change without touching the
 * other. Title validation mirrors handleGroupCreate; avatar validation
 * mirrors an account's own (see realtime/participants.ts#sanitizeAvatar) —
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

  await db.update(conversations).set(updates).where(eq(conversations.id, conversationId));

  // the old file (if it was one of our uploads) is now orphaned — same
  // cleanup an account's own avatar change gets in handleProfile.
  if (updates.avatar !== undefined && conversation.avatar && conversation.avatar !== updates.avatar) {
    const { deleteAvatarFile } = await import('./attachments.js');
    deleteAvatarFile(conversation.avatar).catch((err) => {
      console.error(`[conversations] falha ao apagar avatar antigo do grupo ${conversationId}:`, err instanceof Error ? err.stack : err);
    });
  }

  const memberRows = await db.select({ userId: conversationMembers.userId }).from(conversationMembers).where(eq(conversationMembers.conversationId, conversationId));
  await broadcastConversationListToUsers(memberRows.map((row) => row.userId));
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
  await broadcastConversationListToUsers([...currentIds, ...newIds]);
}

/** Purges a group once it has zero members left (an admin-account deletion
 * can do this too, not just handleGroupMembersRemove below — with no
 * group-discovery UI, a memberless group would otherwise become an
 * invisible, unmanageable row nobody's `conversation-list` query ever
 * surfaces again). Otherwise just refreshes whoever remains. Returns
 * whether the group was purged. */
export async function reconcileGroupMembership(conversationId: string): Promise<boolean> {
  const remainingRows = await db.select({ userId: conversationMembers.userId }).from(conversationMembers).where(eq(conversationMembers.conversationId, conversationId));
  if (remainingRows.length > 0) {
    await broadcastConversationListToUsers(remainingRows.map((row) => row.userId));
    return false;
  }
  const [conversation] = await db.select({ type: conversations.type }).from(conversations).where(eq(conversations.id, conversationId)).limit(1);
  if (conversation?.type !== 'group') return false;
  const { deleteForConversation } = await import('./attachments.js');
  await deleteForConversation(conversationId);
  await db.delete(conversations).where(eq(conversations.id, conversationId));
  return true;
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

  await reconcileGroupMembership(conversationId);
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

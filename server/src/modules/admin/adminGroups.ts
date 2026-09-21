import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { conversationMembers, conversations } from '../../db/schema.js';
import { SOCIAL_PAGE_SIZE, decodeTimeCursor, encodeTimeCursor } from '../friendships/cursor.js';
import { sendConversationUpdateToMembers } from '../conversations/conversationsRepository.js';
import { announceRevocations } from '../conversations/invitationsRepository.js';
import { revokePendingForGroup } from '../conversations/invitationRevocation.js';
import { deleteGroupCompletely } from '../conversations/groupDeletion.js';
import { pageGroupMembers } from '../conversations/groupMembers.js';
import { revokeCallAccess } from '../calls/callAccess.js';
import { recordAudit, recordAuditFailure, listAudit, type AuditActor } from './auditLog.js';

interface Ctx { actor: AuditActor; reason: string; requestId: string }

export type GroupActionResult = { code: 'ok' } | { code: 'not_found' | 'already_suspended' | 'not_suspended' | 'not_member' };

const createdAtIso = sql<string>`to_char(${conversations.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const ownerOf = sql<string | null>`(select m.user_id from conversation_members m where m.conversation_id = ${conversations.id} and m.role = 'owner' limit 1)`;
const memberCountOf = sql<number>`(select count(*)::int from conversation_members m where m.conversation_id = ${conversations.id})`;

export interface AdminGroupRow {
  id: string; title: string; avatar: string; status: string; memberCount: number;
  ownerId: string | null; ownerUsername: string | null; createdBy: string | null; createdAt: string; lastMessageAt: number | null;
}

export interface AdminGroupFilters { q?: string; status?: string; orphan?: boolean }

const groupSelect = {
  group: conversations, ts: createdAtIso, ownerId: ownerOf, memberCount: memberCountOf,
  ownerUsername: sql<string | null>`(select u.username from users u where u.id = ${ownerOf})`,
};

function toRow(r: { group: typeof conversations.$inferSelect; ts: string; ownerId: string | null; memberCount: number; ownerUsername: string | null }): AdminGroupRow {
  return {
    id: r.group.id, title: r.group.title, avatar: r.group.avatar, status: r.group.status, memberCount: r.memberCount,
    ownerId: r.ownerId, ownerUsername: r.ownerUsername, createdBy: r.group.createdBy, createdAt: r.ts,
    lastMessageAt: r.group.lastMessageAt ? r.group.lastMessageAt.getTime() : null,
  };
}

export async function listAdminGroups(filters: AdminGroupFilters, cursorRaw?: string): Promise<{ items: AdminGroupRow[]; nextCursor: string | null } | 'invalid_cursor'> {
  const cursor = cursorRaw ? decodeTimeCursor(cursorRaw) : null;
  if (cursorRaw && !cursor) return 'invalid_cursor';
  const q = filters.q?.trim().toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`);
  const rows = await db
    .select(groupSelect)
    .from(conversations)
    .where(and(
      eq(conversations.type, 'group'),
      q ? sql`(lower(${conversations.title}) like ${`%${q}%`} or ${conversations.id} = ${filters.q?.trim() ?? ''})` : undefined,
      filters.status === 'active' || filters.status === 'suspended' ? eq(conversations.status, filters.status) : undefined,
      filters.orphan ? sql`${ownerOf} is null` : undefined,
      cursor ? sql`(${conversations.createdAt}, ${conversations.id}) < (${cursor.ts}::timestamptz, ${cursor.id})` : undefined,
    ))
    .orderBy(desc(conversations.createdAt), desc(conversations.id))
    .limit(SOCIAL_PAGE_SIZE + 1);
  const page = rows.slice(0, SOCIAL_PAGE_SIZE);
  const last = page[page.length - 1];
  return {
    items: page.map(toRow),
    nextCursor: rows.length > SOCIAL_PAGE_SIZE && last ? encodeTimeCursor(last.ts, last.group.id) : null,
  };
}

/** Administrative detail — reads the group WITHOUT joining it: the admin is
 * not added to `conversation_members` and gets no history, only who is in it. */
export async function getAdminGroup(groupId: string, membersCursor?: string) {
  const [row] = await db.select(groupSelect).from(conversations).where(and(eq(conversations.id, groupId), eq(conversations.type, 'group'))).limit(1);
  if (!row) return null;
  const members = await pageGroupMembers(groupId, membersCursor);
  const history = await listAudit({ targetType: 'group', targetId: groupId });
  return {
    group: { ...toRow(row), statusReason: row.group.statusReason },
    members: members === 'not_found' || members === 'invalid_cursor' ? { items: [], nextCursor: null } : members,
    history: history === 'invalid_cursor' ? [] : history.items,
  };
}

async function announceGroup(groupId: string): Promise<void> {
  const [row] = await db.select().from(conversations).where(eq(conversations.id, groupId)).limit(1);
  if (row) await sendConversationUpdateToMembers('conversation-updated', row);
}

async function memberIdsOf(groupId: string): Promise<string[]> {
  return (await db.select({ userId: conversationMembers.userId }).from(conversationMembers).where(eq(conversationMembers.conversationId, groupId))).map((r) => r.userId);
}

export async function suspendGroup(ctx: Ctx, groupId: string): Promise<GroupActionResult> {
  const outcome = await db.transaction(async (tx): Promise<GroupActionResult & { title?: string }> => {
    const locked = (await tx.execute(sql`select id, title, status from conversations where id = ${groupId} and type = 'group' for update`)).rows as { id: string; title: string; status: string }[];
    const group = locked[0];
    if (!group) return { code: 'not_found' };
    if (group.status === 'suspended') return { code: 'already_suspended' };
    await tx.update(conversations).set({ status: 'suspended', statusReason: ctx.reason, updatedAt: new Date() }).where(eq(conversations.id, groupId));
    await recordAudit({ actor: ctx.actor, action: 'group.suspend', targetType: 'group', targetId: groupId, targetLabel: group.title, reason: ctx.reason, requestId: ctx.requestId }, tx);
    return { code: 'ok', title: group.title };
  });
  if (outcome.code !== 'ok') return outcome;
  await announceGroup(groupId);
  // no access includes the call: cut every member's media connection
  for (const userId of await memberIdsOf(groupId)) void revokeCallAccess(userId, groupId);
  return { code: 'ok' };
}

export async function reactivateGroup(ctx: Ctx, groupId: string): Promise<GroupActionResult> {
  const outcome = await db.transaction(async (tx): Promise<GroupActionResult> => {
    const locked = (await tx.execute(sql`select id, title, status from conversations where id = ${groupId} and type = 'group' for update`)).rows as { id: string; title: string; status: string }[];
    const group = locked[0];
    if (!group) return { code: 'not_found' };
    if (group.status !== 'suspended') return { code: 'not_suspended' };
    await tx.update(conversations).set({ status: 'active', statusReason: '', updatedAt: new Date() }).where(eq(conversations.id, groupId));
    await recordAudit({ actor: ctx.actor, action: 'group.reactivate', targetType: 'group', targetId: groupId, targetLabel: group.title, reason: ctx.reason, requestId: ctx.requestId }, tx);
    return { code: 'ok' };
  });
  if (outcome.code === 'ok') await announceGroup(groupId);
  return outcome;
}

/** Recovery for an ownerless (or unwanted-owner) group: the chosen MEMBER
 * becomes the one owner, whoever held the role before is demoted, in one
 * transaction under the group lock. The admin never becomes a member. */
export async function assignGroupOwner(ctx: Ctx, groupId: string, newOwnerId: string): Promise<GroupActionResult> {
  const outcome = await db.transaction(async (tx): Promise<GroupActionResult & { revoked?: string[] }> => {
    const locked = (await tx.execute(sql`select id, title from conversations where id = ${groupId} and type = 'group' for update`)).rows as { id: string; title: string }[];
    const group = locked[0];
    if (!group) return { code: 'not_found' };
    const [member] = await tx.select({ userId: conversationMembers.userId }).from(conversationMembers)
      .where(and(eq(conversationMembers.conversationId, groupId), eq(conversationMembers.userId, newOwnerId))).limit(1);
    if (!member) return { code: 'not_member' };
    const previous = await tx.select({ userId: conversationMembers.userId }).from(conversationMembers)
      .where(and(eq(conversationMembers.conversationId, groupId), eq(conversationMembers.role, 'owner')));
    await tx.update(conversationMembers).set({ role: 'member' })
      .where(and(eq(conversationMembers.conversationId, groupId), eq(conversationMembers.role, 'owner')));
    await tx.update(conversationMembers).set({ role: 'owner' })
      .where(and(eq(conversationMembers.conversationId, groupId), eq(conversationMembers.userId, newOwnerId)));
    const revoked = await revokePendingForGroup(tx, groupId);
    await recordAudit({
      actor: ctx.actor, action: 'group.assign_owner', targetType: 'group', targetId: groupId, targetLabel: group.title, reason: ctx.reason,
      detail: { newOwnerId, previousOwnerIds: previous.map((p) => p.userId) }, requestId: ctx.requestId,
    }, tx);
    return { code: 'ok', revoked };
  });
  if (outcome.code !== 'ok') return outcome;
  await announceGroup(groupId);
  await announceRevocations(outcome.revoked ?? []);
  return { code: 'ok' };
}

export async function deleteGroupAsAdmin(ctx: Ctx, groupId: string): Promise<GroupActionResult> {
  const [group] = await db.select({ title: conversations.title }).from(conversations).where(and(eq(conversations.id, groupId), eq(conversations.type, 'group'))).limit(1);
  if (!group) return { code: 'not_found' };
  // audit first, in its own row: the group (and its files) are about to stop existing
  await recordAudit({ actor: ctx.actor, action: 'group.delete', targetType: 'group', targetId: groupId, targetLabel: group.title, reason: ctx.reason, requestId: ctx.requestId });
  try {
    const deleted = await deleteGroupCompletely(groupId);
    if (!deleted) return { code: 'not_found' };
  } catch (err) {
    await recordAuditFailure({ actor: ctx.actor, action: 'group.delete', targetType: 'group', targetId: groupId, targetLabel: group.title, reason: ctx.reason, requestId: ctx.requestId }, err);
    throw err;
  }
  return { code: 'ok' };
}

import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { attachments, conversationMembers, conversations, messages, users } from '../../db/schema.js';
import { destroyAllSessionsForUser } from '../auth/session.js';
import { broadcastToKnownPeers } from '../presence/participants.js';
import { deleteAvatarFile } from '../attachments/attachmentCleanup.js';
import { reconcileGroupMembership, sendConversationUpdateToMembers } from '../conversations/conversationsRepository.js';
import { announceRevocations } from '../conversations/invitationsRepository.js';
import { revokePendingForUser } from '../conversations/invitationRevocation.js';
import { SOCIAL_PAGE_SIZE, decodeTimeCursor, encodeTimeCursor } from '../friendships/cursor.js';
import { dropUserConnections } from './accountEnforcement.js';
import { decideUserAction, pickSuccessor, type UserActionDecision } from './adminPolicy.js';
import { listAudit, recordAudit, recordAuditFailure, type AuditActor } from './auditLog.js';

export type UserActionResult<T = object> = ({ code: 'ok' } & T) | { code: 'not_found' | 'confirmation_mismatch' | Exclude<UserActionDecision, 'allow'> };

interface Ctx { actor: AuditActor; reason: string; requestId: string }

/** Locks every admin row (stable order) and then the target — so two admins
 * suspending/deleting each other, or the last two admins racing, serialize
 * and each sees the other's effect. */
async function lockAdminsAndTarget(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], targetId: string) {
  const admins = (await tx.execute(sql`select id, status from users where role = 'admin' order by id for update`)).rows as { id: string; status: string }[];
  const [target] = (await tx.execute(sql`select id, username, role, status, avatar from users where id = ${targetId} for update`)).rows as
    { id: string; username: string; role: string; status: string; avatar: string }[];
  return { activeAdminCount: admins.filter((a) => a.status === 'active').length, target };
}

export async function suspendUser(ctx: Ctx, targetId: string): Promise<UserActionResult> {
  const outcome = await db.transaction(async (tx): Promise<UserActionResult<{ revokedInvitationIds: string[] }>> => {
    const { activeAdminCount, target } = await lockAdminsAndTarget(tx, targetId);
    if (!target) return { code: 'not_found' };
    const decision = decideUserAction({ action: 'suspend', actorId: ctx.actor.id, targetId, targetRole: target.role, targetStatus: target.status, activeAdminCount });
    if (decision !== 'allow') return { code: decision };
    await tx.update(users).set({ status: 'suspended', statusReason: ctx.reason, statusChangedAt: new Date(), updatedAt: new Date() }).where(eq(users.id, targetId));
    const revokedInvitationIds = await revokePendingForUser(tx, targetId);
    await recordAudit({ actor: ctx.actor, action: 'user.suspend', targetType: 'user', targetId, targetLabel: target.username, reason: ctx.reason, requestId: ctx.requestId }, tx);
    return { code: 'ok', revokedInvitationIds };
  });
  if (outcome.code !== 'ok') return outcome;

  await destroyAllSessionsForUser(targetId);
  dropUserConnections(targetId);
  void announceRevocations(outcome.revokedInvitationIds);
  return { code: 'ok' };
}

export async function reactivateUser(ctx: Ctx, targetId: string): Promise<UserActionResult> {
  return db.transaction(async (tx): Promise<UserActionResult> => {
    const { activeAdminCount, target } = await lockAdminsAndTarget(tx, targetId);
    if (!target) return { code: 'not_found' };
    const decision = decideUserAction({ action: 'reactivate', actorId: ctx.actor.id, targetId, targetRole: target.role, targetStatus: target.status, activeAdminCount });
    if (decision !== 'allow') return { code: decision };
    await tx.update(users).set({ status: 'active', statusReason: '', statusChangedAt: new Date(), updatedAt: new Date() }).where(eq(users.id, targetId));
    await recordAudit({ actor: ctx.actor, action: 'user.reactivate', targetType: 'user', targetId, targetLabel: target.username, reason: ctx.reason, requestId: ctx.requestId }, tx);
    return { code: 'ok' };
  });
}

/** Ends every session of the account without suspending it. */
export async function revokeUserSessions(ctx: Ctx, targetId: string): Promise<UserActionResult> {
  const [target] = await db.select({ username: users.username }).from(users).where(eq(users.id, targetId)).limit(1);
  if (!target) return { code: 'not_found' };
  await destroyAllSessionsForUser(targetId);
  dropUserConnections(targetId);
  await recordAudit({ actor: ctx.actor, action: 'user.revoke_sessions', targetType: 'user', targetId, targetLabel: target.username, reason: ctx.reason, requestId: ctx.requestId });
  return { code: 'ok' };
}

/** Deletes an account (§7.4/§7.5). Every group it OWNS first passes to the
 * member who has been there longest — under the group row lock, in the same
 * transaction as the delete — so no group is ever left without an owner. A
 * group with nobody else left is emptied by the delete and removed right
 * after by reconcileGroupMembership (files included). */
export async function deleteUserAccount(ctx: Ctx, targetId: string, confirm: string): Promise<UserActionResult> {
  const [known] = await db.select({ username: users.username }).from(users).where(eq(users.id, targetId)).limit(1);
  if (!known) return { code: 'not_found' };
  if (confirm.trim().toLowerCase() !== known.username.toLowerCase()) return { code: 'confirmation_mismatch' };

  const outcome = await db.transaction(async (tx): Promise<UserActionResult<{
    username: string; avatar: string; groupIds: string[]; successions: { groupId: string; newOwnerId: string }[];
  }>> => {
    const { activeAdminCount, target } = await lockAdminsAndTarget(tx, targetId);
    if (!target) return { code: 'not_found' };
    const decision = decideUserAction({ action: 'delete', actorId: ctx.actor.id, targetId, targetRole: target.role, targetStatus: target.status, activeAdminCount });
    if (decision !== 'allow') return { code: decision };

    const memberships = await tx.select({ conversationId: conversationMembers.conversationId, role: conversationMembers.role })
      .from(conversationMembers)
      .innerJoin(conversations, eq(conversations.id, conversationMembers.conversationId))
      .where(and(eq(conversationMembers.userId, targetId), eq(conversations.type, 'group')))
      .orderBy(asc(conversationMembers.conversationId));

    const successions: { groupId: string; newOwnerId: string }[] = [];
    for (const m of memberships) {
      if (m.role !== 'owner') continue;
      await tx.execute(sql`select id from conversations where id = ${m.conversationId} for update`);
      const members = await tx.select({ userId: conversationMembers.userId, joinedAt: conversationMembers.joinedAt, role: conversationMembers.role })
        .from(conversationMembers).where(eq(conversationMembers.conversationId, m.conversationId));
      // the role read before the lock can be stale (a concurrent transfer may
      // already have handed the group over) — only act on what the lock shows
      if (members.find((x) => x.userId === targetId)?.role !== 'owner') continue;
      const successor = pickSuccessor(members, targetId);
      if (!successor) continue;
      // the partial unique index allows ONE owner per group, so the departing
      // owner steps down before the successor steps up
      await tx.update(conversationMembers).set({ role: 'member' })
        .where(and(eq(conversationMembers.conversationId, m.conversationId), eq(conversationMembers.userId, targetId)));
      await tx.update(conversationMembers).set({ role: 'owner' })
        .where(and(eq(conversationMembers.conversationId, m.conversationId), eq(conversationMembers.userId, successor)));
      successions.push({ groupId: m.conversationId, newOwnerId: successor });
      await recordAudit({
        actor: ctx.actor, action: 'group.owner_succession', targetType: 'group', targetId: m.conversationId,
        reason: `dono ${target.username} excluído`, detail: { newOwnerId: successor, previousOwnerId: targetId }, requestId: ctx.requestId,
      }, tx);
    }

    await tx.delete(users).where(eq(users.id, targetId));
    await recordAudit({
      actor: ctx.actor, action: 'user.delete', targetType: 'user', targetId, targetLabel: target.username, reason: ctx.reason,
      detail: { groups: memberships.length, successions: successions.length }, requestId: ctx.requestId,
    }, tx);
    return { code: 'ok', username: target.username, avatar: target.avatar, groupIds: memberships.map((m) => m.conversationId), successions };
  });
  if (outcome.code !== 'ok') return outcome;

  // the sessions cascaded away with the row; live connections still need cutting
  await destroyAllSessionsForUser(targetId);
  dropUserConnections(targetId);
  broadcastToKnownPeers(targetId, { t: 'user-deleted', userId: targetId });

  for (const { groupId } of outcome.successions) {
    const [row] = await db.select().from(conversations).where(eq(conversations.id, groupId)).limit(1);
    if (row) await sendConversationUpdateToMembers('conversation-updated', row);
  }
  for (const groupId of outcome.groupIds) await reconcileGroupMembership(groupId, targetId);

  if (outcome.avatar) {
    await deleteAvatarFile(outcome.avatar).catch((err) => recordAuditFailure(
      { actor: ctx.actor, action: 'user.delete.avatar_cleanup', targetType: 'user', targetId, targetLabel: outcome.username, requestId: ctx.requestId }, err,
    ));
  }
  return { code: 'ok' };
}

// ---- reads -------------------------------------------------------------------

const createdAtIso = sql<string>`to_char(${users.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

export interface AdminUserRow {
  id: string; username: string; displayName: string; avatar: string; avatarColor: string;
  role: string; status: string; createdAt: string;
}

export interface AdminUserFilters { q?: string; status?: string; role?: string; from?: string; to?: string }

const isoDate = (raw: string | undefined): Date | null => {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
};

export async function listAdminUsers(filters: AdminUserFilters, cursorRaw?: string): Promise<{ items: AdminUserRow[]; nextCursor: string | null } | 'invalid_cursor'> {
  const cursor = cursorRaw ? decodeTimeCursor(cursorRaw) : null;
  if (cursorRaw && !cursor) return 'invalid_cursor';
  const q = filters.q?.trim().toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`);
  const from = isoDate(filters.from);
  const to = isoDate(filters.to);
  const rows = await db
    .select({ user: users, ts: createdAtIso })
    .from(users)
    .where(and(
      q ? sql`(lower(${users.username}) like ${`%${q}%`} or lower(${users.displayName}) like ${`%${q}%`})` : undefined,
      filters.status === 'active' || filters.status === 'suspended' ? eq(users.status, filters.status) : undefined,
      filters.role === 'admin' || filters.role === 'user' ? eq(users.role, filters.role) : undefined,
      from ? sql`${users.createdAt} >= ${from.toISOString()}::timestamptz` : undefined,
      to ? sql`${users.createdAt} < ${to.toISOString()}::timestamptz` : undefined,
      cursor ? sql`(${users.createdAt}, ${users.id}) < (${cursor.ts}::timestamptz, ${cursor.id})` : undefined,
    ))
    .orderBy(desc(users.createdAt), desc(users.id))
    .limit(SOCIAL_PAGE_SIZE + 1);
  const page = rows.slice(0, SOCIAL_PAGE_SIZE);
  const last = page[page.length - 1];
  return {
    items: page.map(({ user: u, ts }) => ({
      id: u.id, username: u.username, displayName: u.displayName.trim() || u.username, avatar: u.avatar, avatarColor: u.avatarColor,
      role: u.role, status: u.status, createdAt: ts,
    })),
    nextCursor: rows.length > SOCIAL_PAGE_SIZE && last ? encodeTimeCursor(last.ts, last.user.id) : null,
  };
}

/** Operational detail for one account. E-mail appears here only — never the
 * password hash, sessions or tokens — and reading it is not a privileged
 * social action, so it is not audited (evidence access is; see reports). */
export async function getAdminUser(userId: string) {
  const [row] = await db.select({ user: users, ts: createdAtIso }).from(users).where(eq(users.id, userId)).limit(1);
  if (!row) return null;
  const u = row.user;
  const groups = await db
    .select({ id: conversations.id, title: conversations.title, status: conversations.status, role: conversationMembers.role })
    .from(conversationMembers)
    .innerJoin(conversations, eq(conversations.id, conversationMembers.conversationId))
    .where(and(eq(conversationMembers.userId, userId), eq(conversations.type, 'group')))
    .orderBy(asc(conversations.title));
  // bytes attributable to the account: attachments on messages it authored
  const [usage] = await db
    .select({ bytes: sql<number>`coalesce(sum(${attachments.size}), 0)::float8`, files: sql<number>`count(${attachments.id})::int` })
    .from(attachments)
    .innerJoin(messages, eq(messages.id, attachments.messageId))
    .where(and(eq(messages.authorId, userId), eq(attachments.isThumbnail, false)));
  const history = await listAudit({ targetType: 'user', targetId: userId });
  return {
    user: {
      id: u.id, username: u.username, displayName: u.displayName.trim() || u.username, email: u.email, avatar: u.avatar, avatarColor: u.avatarColor,
      role: u.role, status: u.status, statusReason: u.statusReason,
      statusChangedAt: u.statusChangedAt ? u.statusChangedAt.toISOString() : null, createdAt: row.ts,
    },
    groups,
    storage: { bytes: usage?.bytes ?? 0, files: usage?.files ?? 0 },
    history: history === 'invalid_cursor' ? [] : history.items,
  };
}

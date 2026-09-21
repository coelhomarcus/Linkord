// Pure decisions for administrative actions — no DB, so the rules that keep
// the instance administrable (never lock out the last admin, never act on
// yourself) are testable on their own. The callers enforce them INSIDE the
// transaction that holds the relevant row locks.

export type UserAction = 'suspend' | 'reactivate' | 'delete';
export type UserActionDecision = 'allow' | 'self' | 'last_admin' | 'already_suspended' | 'not_suspended';

export function decideUserAction(input: {
  action: UserAction;
  actorId: string;
  targetId: string;
  targetRole: string;
  targetStatus: string;
  /** Active admins BEFORE the action, the target included when it is one. */
  activeAdminCount: number;
}): UserActionDecision {
  const { action, actorId, targetId, targetRole, targetStatus, activeAdminCount } = input;
  if (action === 'reactivate') return targetStatus === 'suspended' ? 'allow' : 'not_suspended';
  if (actorId === targetId) return 'self';
  if (action === 'suspend' && targetStatus === 'suspended') return 'already_suspended';
  const removesAnActiveAdmin = targetRole === 'admin' && targetStatus === 'active';
  if (removesAnActiveAdmin && activeAdminCount <= 1) return 'last_admin';
  return 'allow';
}

export type AdminRoleAction = 'grant' | 'revoke';
export type AdminRoleDecision = 'allow' | 'self' | 'last_admin' | 'already_admin' | 'not_admin' | 'target_inactive';

/** Granting or removing the admin role. Granting needs an active, non-admin
 * account. Removing needs an admin, is never done on yourself (no lockout by
 * accident) and can never take the last ACTIVE admin. */
export function decideAdminRoleChange(input: {
  action: AdminRoleAction; actorId: string; targetId: string; targetRole: string; targetStatus: string; activeAdminCount: number;
}): AdminRoleDecision {
  const { action, actorId, targetId, targetRole, targetStatus, activeAdminCount } = input;
  if (action === 'grant') {
    if (targetStatus !== 'active') return 'target_inactive';
    return targetRole === 'admin' ? 'already_admin' : 'allow';
  }
  if (targetRole !== 'admin') return 'not_admin';
  if (actorId === targetId) return 'self';
  if (targetStatus === 'active' && activeAdminCount <= 1) return 'last_admin';
  return 'allow';
}

/** Successor when a group's owner disappears (§7.4): oldest membership first,
 * ties broken by user id, never the departing owner. null = nobody left. */
export function pickSuccessor(members: { userId: string; joinedAt: Date }[], departingId: string): string | null {
  const candidates = members
    .filter((m) => m.userId !== departingId)
    .sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime() || (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0));
  return candidates[0]?.userId ?? null;
}

/** Actions that need a written justification (§7.5). */
export const REASON_MIN_LENGTH = 3;
export const REASON_MAX_LENGTH = 500;

export function normalizeReason(raw: unknown): string | null {
  const reason = String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim();
  return reason.length >= REASON_MIN_LENGTH && reason.length <= REASON_MAX_LENGTH ? reason : null;
}

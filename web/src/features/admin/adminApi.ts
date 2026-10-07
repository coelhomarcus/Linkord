import { ApiError, apiFetch } from '@/shared/api/api';
import { ERROR_CODES } from '@/shared/api/errorCodes';
import { reportAdminAccessLost, reportAdminSessionEnded } from './adminAccess';
import { invalidateAdminLists } from './adminListCache';

// Client for /api/admin/* (docs/plano-rede-social.md §9). The server is the
// authority on every one of these — a non-admin gets 403 whatever the UI shows.

export interface Page<T> { items: T[]; nextCursor: string | null }

/** apiFetch plus two rules, so the area reacts as a whole instead of each page
 * showing its own error: a 403 `forbidden` means the server no longer sees this
 * account as an administrator (demoted, suspended, role out of date); a 401
 * means there is no session any more (expired, revoked — even by this very admin). */
async function adminFetch<T>(path: string, init?: RequestInit): Promise<T> {
  try {
    const result = await apiFetch<T>(path, init);
    // anything but a read may have changed what a remembered list shows
    if (init?.method && init.method !== 'GET') invalidateAdminLists();
    return result;
  } catch (err) {
    if (err instanceof ApiError && err.status === 403 && err.code === ERROR_CODES.forbidden) reportAdminAccessLost();
    else if (err instanceof ApiError && err.status === 401) reportAdminSessionEnded();
    throw err;
  }
}

function qs(params: Record<string, string | boolean | null | undefined>): string {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === true) q.set(key, '1');
    else if (typeof value === 'string' && value) q.set(key, value);
  }
  const text = q.toString();
  return text ? `?${text}` : '';
}

const post = <T = { ok: true }>(path: string, body: Record<string, unknown>) => adminFetch<T>(path, { method: 'POST', body: JSON.stringify(body) });

// ---- users -------------------------------------------------------------------

export interface AdminUserRow {
  id: string; username: string; displayName: string; avatar: string; avatarColor: string;
  role: 'user' | 'admin'; status: 'active' | 'suspended'; createdAt: string;
}
export interface AuditRow {
  id: string; at: string; actorId: string | null; actorLabel: string; action: string; targetType: string;
  targetId: string; targetLabel: string; reason: string; result: 'ok' | 'failed'; detail: Record<string, unknown>; requestId: string;
}
export interface AdminUserDetail {
  user: AdminUserRow & { email: string | null; statusReason: string; statusChangedAt: string | null };
  groups: { id: string; title: string; status: string; role: 'owner' | 'member' }[];
  storage: { bytes: number; files: number };
  history: AuditRow[];
}

export const fetchAdminUsers = (filters: { q?: string; status?: string; role?: string; from?: string; to?: string }, cursor: string | null) =>
  adminFetch<Page<AdminUserRow>>(`/api/admin/users${qs({ ...filters, cursor })}`);
export const fetchAdminUser = (id: string) => adminFetch<AdminUserDetail>(`/api/admin/users/${encodeURIComponent(id)}`);
export const suspendUser = (id: string, reason: string) => post(`/api/admin/users/${encodeURIComponent(id)}/suspend`, { reason });
export const reactivateUser = (id: string, reason: string) => post(`/api/admin/users/${encodeURIComponent(id)}/reactivate`, { reason });
export const grantAdmin = (id: string, reason: string) => post(`/api/admin/users/${encodeURIComponent(id)}/grant-admin`, { reason });
export const revokeAdmin = (id: string, reason: string) => post(`/api/admin/users/${encodeURIComponent(id)}/revoke-admin`, { reason });
export const revokeUserSessions = (id: string, reason: string) => post(`/api/admin/users/${encodeURIComponent(id)}/revoke-sessions`, { reason });
export const deleteUser = (id: string, reason: string, confirm: string) =>
  adminFetch<{ ok: true }>(`/api/admin/users/${encodeURIComponent(id)}`, { method: 'DELETE', body: JSON.stringify({ reason, confirm }) });

// ---- groups ------------------------------------------------------------------

export interface AdminGroupRow {
  id: string; title: string; avatar: string; status: 'active' | 'suspended'; memberCount: number;
  ownerId: string | null; ownerUsername: string | null; createdBy: string | null; createdAt: string; lastMessageAt: number | null;
}
export interface AdminGroupMember { user: { id: string; username: string; displayName: string; avatar: string; avatarColor: string }; role: 'owner' | 'member'; at: string }
export interface AdminGroupDetail {
  group: AdminGroupRow & { statusReason: string };
  members: Page<AdminGroupMember>;
  history: AuditRow[];
}

export const fetchAdminGroups = (filters: { q?: string; status?: string; orphan?: boolean }, cursor: string | null) =>
  adminFetch<Page<AdminGroupRow>>(`/api/admin/groups${qs({ ...filters, cursor })}`);
export const fetchAdminGroup = (id: string, cursor?: string | null) => adminFetch<AdminGroupDetail>(`/api/admin/groups/${encodeURIComponent(id)}${qs({ cursor })}`);
export const suspendGroup = (id: string, reason: string) => post(`/api/admin/groups/${encodeURIComponent(id)}/suspend`, { reason });
export const reactivateGroup = (id: string, reason: string) => post(`/api/admin/groups/${encodeURIComponent(id)}/reactivate`, { reason });
export const assignGroupOwner = (id: string, userId: string, reason: string) => post(`/api/admin/groups/${encodeURIComponent(id)}/owner`, { userId, reason });
export const deleteGroup = (id: string, reason: string) =>
  adminFetch<{ ok: true }>(`/api/admin/groups/${encodeURIComponent(id)}`, { method: 'DELETE', body: JSON.stringify({ reason }) });

// ---- reports -----------------------------------------------------------------

export interface AdminReportRow {
  id: string; targetType: 'user' | 'group' | 'message'; targetId: string; targetLabel: string; category: string;
  status: 'open' | 'reviewing' | 'resolved' | 'dismissed'; reporter: string | null; assignee: string | null; createdAt: string;
}
export interface AdminReportDetail {
  report: AdminReportRow & { details: string; snapshot: Record<string, unknown>; resolution: string; resolutionNote: string; resolvedAt: string | null };
  history: AuditRow[];
}
export type ReportAction = 'suspend_user' | 'suspend_group' | 'delete_message';

export const fetchAdminReports = (filters: { status?: string; targetType?: string }, cursor: string | null) =>
  adminFetch<Page<AdminReportRow>>(`/api/admin/reports${qs({ ...filters, cursor })}`);
export const fetchAdminReport = (id: string) => adminFetch<AdminReportDetail>(`/api/admin/reports/${encodeURIComponent(id)}`);
export const claimReport = (id: string, reason: string) => post(`/api/admin/reports/${encodeURIComponent(id)}/claim`, { reason });
export const resolveReport = (id: string, input: { reason: string; action: ReportAction | null; dismiss: boolean }) =>
  post(`/api/admin/reports/${encodeURIComponent(id)}/resolve`, input);

// ---- audit -------------------------------------------------------------------

export const fetchAudit = (filters: { actor?: string; targetType?: string; targetId?: string; action?: string; from?: string; to?: string }, cursor: string | null) =>
  adminFetch<Page<AuditRow>>(`/api/admin/audit${qs({ ...filters, cursor })}`);

// ---- system ------------------------------------------------------------------

export interface SweepResult {
  at: string; dryRun: boolean; scanned: number; orphanCount: number; orphanBytes: number; deleted: number; failed: number; recent: number; missingFiles: number;
}
export interface SystemInfo {
  storage: { usedBytes: number; files: number; maxBytes: number };
  connections: { live: number; onlineAccounts: number; max: number; perAccountMax: number };
  accounts: { total: number; newLastHour: number; newPerHourCap: number; activeAdmins: number; suspended: number };
  livekit: { configured: boolean };
  outbox: { pending: number; failed: number };
  notifications: { unread: number };
  orphanSweep: { dryRunByDefault: boolean; /** absent on a server that predates it */ graceMs?: number; last: SweepResult | null };
}

export const fetchSystem = () => adminFetch<SystemInfo>('/api/admin/system');
export const sweepOrphans = (input: { dryRun: true } | { dryRun: false; reason: string }) =>
  adminFetch<{ result: SweepResult }>('/api/admin/system/sweep-orphans', { method: 'POST', body: JSON.stringify(input) });

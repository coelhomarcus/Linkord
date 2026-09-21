import { apiFetch } from '@/shared/api/api';

// Client for /api/admin/* (docs/plano-rede-social.md §9). The server is the
// authority on every one of these — a non-admin gets 403 whatever the UI shows.

export interface Page<T> { items: T[]; nextCursor: string | null }

function qs(params: Record<string, string | boolean | null | undefined>): string {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === true) q.set(key, '1');
    else if (typeof value === 'string' && value) q.set(key, value);
  }
  const text = q.toString();
  return text ? `?${text}` : '';
}

const post = <T = { ok: true }>(path: string, body: Record<string, unknown>) => apiFetch<T>(path, { method: 'POST', body: JSON.stringify(body) });

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

export const fetchAdminUsers = (filters: { q?: string; status?: string; role?: string }, cursor: string | null) =>
  apiFetch<Page<AdminUserRow>>(`/api/admin/users${qs({ ...filters, cursor })}`);
export const fetchAdminUser = (id: string) => apiFetch<AdminUserDetail>(`/api/admin/users/${encodeURIComponent(id)}`);
export const suspendUser = (id: string, reason: string) => post(`/api/admin/users/${encodeURIComponent(id)}/suspend`, { reason });
export const reactivateUser = (id: string, reason: string) => post(`/api/admin/users/${encodeURIComponent(id)}/reactivate`, { reason });
export const revokeUserSessions = (id: string, reason: string) => post(`/api/admin/users/${encodeURIComponent(id)}/revoke-sessions`, { reason });
export const deleteUser = (id: string, reason: string, confirm: string) =>
  apiFetch<{ ok: true }>(`/api/admin/users/${encodeURIComponent(id)}`, { method: 'DELETE', body: JSON.stringify({ reason, confirm }) });

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
  apiFetch<Page<AdminGroupRow>>(`/api/admin/groups${qs({ ...filters, cursor })}`);
export const fetchAdminGroup = (id: string, cursor?: string | null) => apiFetch<AdminGroupDetail>(`/api/admin/groups/${encodeURIComponent(id)}${qs({ cursor })}`);
export const suspendGroup = (id: string, reason: string) => post(`/api/admin/groups/${encodeURIComponent(id)}/suspend`, { reason });
export const reactivateGroup = (id: string, reason: string) => post(`/api/admin/groups/${encodeURIComponent(id)}/reactivate`, { reason });
export const assignGroupOwner = (id: string, userId: string, reason: string) => post(`/api/admin/groups/${encodeURIComponent(id)}/owner`, { userId, reason });
export const deleteGroup = (id: string, reason: string) =>
  apiFetch<{ ok: true }>(`/api/admin/groups/${encodeURIComponent(id)}`, { method: 'DELETE', body: JSON.stringify({ reason }) });

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

export const fetchAdminReports = (filters: { status?: string }, cursor: string | null) =>
  apiFetch<Page<AdminReportRow>>(`/api/admin/reports${qs({ ...filters, cursor })}`);
export const fetchAdminReport = (id: string) => apiFetch<AdminReportDetail>(`/api/admin/reports/${encodeURIComponent(id)}`);
export const claimReport = (id: string, reason: string) => post(`/api/admin/reports/${encodeURIComponent(id)}/claim`, { reason });
export const resolveReport = (id: string, input: { reason: string; action: ReportAction | null; dismiss: boolean }) =>
  post(`/api/admin/reports/${encodeURIComponent(id)}/resolve`, input);

// ---- audit -------------------------------------------------------------------

export const fetchAudit = (filters: { actor?: string; targetType?: string; targetId?: string; action?: string; from?: string; to?: string }, cursor: string | null) =>
  apiFetch<Page<AuditRow>>(`/api/admin/audit${qs({ ...filters, cursor })}`);

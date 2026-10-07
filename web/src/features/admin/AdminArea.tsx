import { Navigate, Route, Routes } from 'react-router';
import { useRoom } from '@/state/RoomContext';
import { ROUTES } from '@/shared/lib/routes';
import { AuditPage } from './AuditPage';
import { AdminLayout } from './AdminLayout';
import { AdminIndex } from './AdminNavigation';
import { GroupDetailPage } from './GroupDetailPage';
import { GroupsPage } from './GroupsPage';
import { ReportDetailPage } from './ReportDetailPage';
import { ReportsPage } from './ReportsPage';
import { SystemPage } from './SystemPage';
import { UserDetailPage } from './UserDetailPage';
import { UsersPage } from './UsersPage';
import { useAdminMeasured, useAdminMode } from './useAdminMode';

/** Bare /admin: the section index when there is no sidebar to pick from,
 * Users otherwise. Only this entry depends on the mode — a detail URL is
 * never redirected because of the window size. */
function AdminEntry() {
  const mode = useAdminMode();
  // before the first measurement `mode` is a guess: deciding on it would redirect a narrow screen
  if (!useAdminMeasured()) return null;
  return mode === 'compact' ? <AdminIndex /> : <Navigate to={ROUTES.admin} replace />;
}

/** The administrative area (docs/plano-rede-social.md §9). Loaded on demand —
 * ordinary users never download it — and mounted under the same shell as the
 * rest of the app, so opening it during a call doesn't touch the call. The
 * guard only hides the UI: every endpoint re-checks the admin role on the
 * server. */
export default function AdminArea() {
  const { state } = useRoom();
  if (state.me.role !== 'admin') return <Navigate to={ROUTES.conversations} replace />;

  return (
    <Routes>
      <Route element={<AdminLayout />}>
        <Route index element={<AdminEntry />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="users/:id" element={<UserDetailPage />} />
        <Route path="groups" element={<GroupsPage />} />
        <Route path="groups/:id" element={<GroupDetailPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="reports/:id" element={<ReportDetailPage />} />
        <Route path="audit" element={<AuditPage />} />
        <Route path="system" element={<SystemPage />} />
        <Route path="*" element={<Navigate to={ROUTES.admin} replace />} />
      </Route>
    </Routes>
  );
}

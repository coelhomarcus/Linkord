import { Navigate, NavLink, Route, Routes } from 'react-router';
import { useRoom } from '@/state/RoomContext';
import { SocialPageLayout } from '@/features/friends/SocialPageLayout';
import { ROUTES } from '@/shared/lib/routes';
import { cn } from '@/shared/lib/utils';
import { AuditPage } from './AuditPage';
import { GroupDetailPage } from './GroupDetailPage';
import { GroupsPage } from './GroupsPage';
import { ReportDetailPage } from './ReportDetailPage';
import { ReportsPage } from './ReportsPage';
import { UserDetailPage } from './UserDetailPage';
import { UsersPage } from './UsersPage';

const NAV = [
  { to: '/admin/users', label: 'Usuários' },
  { to: '/admin/groups', label: 'Grupos' },
  { to: '/admin/reports', label: 'Denúncias' },
  { to: '/admin/audit', label: 'Auditoria' },
] as const;

/** The administrative area (docs/plano-rede-social.md §9). Loaded on demand —
 * ordinary users never download it — and mounted under the same shell as the
 * rest of the app, so opening it during a call doesn't touch the call. The
 * guard only hides the UI: every endpoint re-checks the admin role on the
 * server. */
export default function AdminArea() {
  const { state } = useRoom();
  if (state.me.role !== 'admin') return <Navigate to={ROUTES.conversations} replace />;

  return (
    <SocialPageLayout title="Administração" subtitle="Área restrita — toda ação fica registrada na auditoria">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        <nav aria-label="Administração" className="flex flex-wrap gap-1 rounded-lg bg-white/[0.05] p-0.5 self-start">
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => cn(
              'rounded-md px-3 py-1 text-label font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              isActive ? 'bg-primary/15 text-text-primary' : 'text-text-muted hover:text-text-primary',
            )}>{item.label}</NavLink>
          ))}
        </nav>
        <Routes>
          <Route path="users" element={<UsersPage />} />
          <Route path="users/:id" element={<UserDetailPage />} />
          <Route path="groups" element={<GroupsPage />} />
          <Route path="groups/:id" element={<GroupDetailPage />} />
          <Route path="reports" element={<ReportsPage />} />
          <Route path="reports/:id" element={<ReportDetailPage />} />
          <Route path="audit" element={<AuditPage />} />
          <Route path="*" element={<Navigate to="/admin/users" replace />} />
        </Routes>
      </div>
    </SocialPageLayout>
  );
}

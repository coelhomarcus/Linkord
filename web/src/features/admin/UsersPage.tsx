import { useCallback } from 'react';
import { Link, useLocation } from 'react-router';
import { Search } from 'lucide-react';
import { Avatar } from '@/shared/Avatar';
import { Button } from '@/shared/ui/primitives/button';
import { Segmented } from '@/features/friends/Segmented';
import { useCursorList } from '@/shared/hooks/useCursorList';
import { useUrlSearch } from '@/shared/hooks/useUrlSearch';
import { ROUTES } from '@/shared/lib/routes';
import { fetchAdminUsers } from './adminApi';
import { formatWhen } from './adminFormat';
import { Badge, ListChrome } from './adminUi';
import { fromList } from './useAdminBack';
import { useAdminQuery } from './useAdminQuery';
import type { QuerySchema } from './useAdminQuery';

type StatusFilter = 'all' | 'active' | 'suspended';
type RoleFilter = 'all' | 'admin';

const QUERY: QuerySchema<'q' | 'status' | 'role'> = {
  q: { default: '' },
  status: { default: 'all', allowed: ['all', 'active', 'suspended'] },
  role: { default: 'all', allowed: ['all', 'admin'] },
};

export function UsersPage() {
  const { filters, update, clear, active, identity } = useAdminQuery(QUERY);
  const { pathname, search } = useLocation();
  const { value: query, setValue: setQuery } = useUrlSearch(filters.q, (q) => update({ q }));
  const status = filters.status as StatusFilter;
  const role = filters.role as RoleFilter;
  const fetchPage = useCallback((cursor: string | null) => fetchAdminUsers({
    q: filters.q, status: status === 'all' ? undefined : status, role: role === 'all' ? undefined : role,
  }, cursor), [filters.q, status, role]);
  const list = useCursorList(fetchPage, identity);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-48 flex-1 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3">
          <Search size={15} className="text-text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar por usuário ou nome"
            aria-label="Buscar usuários"
            className="h-9 min-w-0 flex-1 bg-transparent text-label outline-none placeholder:text-text-muted"
          />
        </div>
        <Segmented<StatusFilter> label="Situação" value={status} onChange={(next) => update({ status: next })} options={[{ value: 'all', label: 'Todos' }, { value: 'active', label: 'Ativos' }, { value: 'suspended', label: 'Suspensos' }]} />
        <Segmented<RoleFilter> label="Papel" value={role} onChange={(next) => update({ role: next })} options={[{ value: 'all', label: 'Qualquer papel' }, { value: 'admin', label: 'Admins' }]} />
      </div>
      <ListChrome list={list} empty="Nenhuma conta encontrada." emptyAction={active ? <Button type="button" variant="secondary" size="sm" onClick={clear}>Limpar filtros</Button> : undefined}>
        {list.items.map((u) => (
          <Link key={u.id} to={`/admin/users/${u.id}`} state={fromList(pathname, search)} className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <Avatar id={u.id} name={u.displayName} avatar={u.avatar} avatarColor={u.avatarColor} size={36} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-body font-medium text-text-primary">{u.displayName}</p>
              <p className="truncate text-caption text-text-muted">@{u.username} · criada em {formatWhen(u.createdAt)}</p>
            </div>
            {u.role === 'admin' && <Badge value="admin" />}
            <Badge value={u.status} />
          </Link>
        ))}
      </ListChrome>
      <p className="text-caption text-text-muted">Voltar às <Link to={ROUTES.conversations} className="underline">conversas</Link>.</p>
    </div>
  );
}

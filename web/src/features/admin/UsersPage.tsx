import { useCallback } from 'react';
import { Link, useLocation } from 'react-router';
import { History } from 'lucide-react';
import { Avatar } from '@/shared/Avatar';
import { buttonVariants } from '@/shared/ui/primitives/button';
import { useCursorList } from '@/shared/hooks/useCursorList';
import { useUrlSearch } from '@/shared/hooks/useUrlSearch';
import { fetchAdminUsers } from './adminApi';
import type { AdminUserRow } from './adminApi';
import { dayStartIso, formatWhen, nextDayStartIso } from './adminFormat';
import { AdminDateField, AdminListToolbar, AdminSelectField } from './AdminListToolbar';
import { AdminTable, AdminTd, AdminTh, AdminTr } from './AdminTable';
import { Badge, ListChrome } from './adminUi';
import { CopyIdButton } from './CopyIdButton';
import { fromList } from './useAdminBack';
import { useAdminMode } from './useAdminMode';
import { useAdminQuery } from './useAdminQuery';
import type { QuerySchema } from './useAdminQuery';

type StatusFilter = 'all' | 'active' | 'suspended';
type RoleFilter = 'all' | 'admin' | 'user';

const QUERY: QuerySchema<'q' | 'status' | 'role' | 'from' | 'to'> = {
  q: { default: '' },
  status: { default: 'all', allowed: ['all', 'active', 'suspended'] },
  role: { default: 'all', allowed: ['all', 'admin', 'user'] },
  from: { default: '' },
  to: { default: '' },
};

function RowActions({ user }: { user: AdminUserRow }) {
  return (
    <div className="flex items-center justify-end gap-0.5">
      <CopyIdButton id={user.id} label={`Copiar ID de ${user.displayName}`} />
      <Link to={`/admin/audit?targetId=${encodeURIComponent(user.id)}`} aria-label={`Ver histórico de ${user.displayName}`} title="Ver histórico" className={buttonVariants({ variant: 'ghost', size: 'icon-sm' })}>
        <History size={15} aria-hidden />
      </Link>
    </div>
  );
}

function UserIdentity({ user, from }: { user: AdminUserRow; from: { from: string } }) {
  return (
    <Link to={`/admin/users/${user.id}`} state={from} className="flex min-w-0 items-center gap-3 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <Avatar id={user.id} name={user.displayName} avatar={user.avatar} avatarColor={user.avatarColor} size={36} />
      <span className="min-w-0">
        <span className="block truncate text-body font-medium text-text-primary">{user.displayName}</span>
        <span className="block truncate text-caption text-text-muted">@{user.username}</span>
      </span>
    </Link>
  );
}

export function UsersPage() {
  const { filters, update, clear, active, identity } = useAdminQuery(QUERY);
  const { pathname, search } = useLocation();
  const mode = useAdminMode();
  const { value: query, setValue: setQuery } = useUrlSearch(filters.q, (q) => update({ q }));
  const status = filters.status as StatusFilter;
  const role = filters.role as RoleFilter;
  const fetchPage = useCallback((cursor: string | null) => fetchAdminUsers({
    q: filters.q,
    status: status === 'all' ? undefined : status,
    role: role === 'all' ? undefined : role,
    from: dayStartIso(filters.from),
    to: nextDayStartIso(filters.to),
  }, cursor), [filters.q, status, role, filters.from, filters.to]);
  const list = useCursorList(fetchPage, identity, { getKey: (u) => u.id });
  const origin = fromList(pathname, search);

  return (
    <div className="flex flex-col gap-4">
      <AdminListToolbar
        search={{ value: query, onChange: setQuery, placeholder: 'Buscar por nome, usuário ou ID', label: 'Buscar usuários' }}
        filters={(
          <>
            <AdminSelectField<StatusFilter> label="Situação" value={status} onChange={(next) => update({ status: next })}
              options={[{ value: 'all', label: 'Todas' }, { value: 'active', label: 'Ativas' }, { value: 'suspended', label: 'Suspensas' }]} />
            <AdminSelectField<RoleFilter> label="Papel" value={role} onChange={(next) => update({ role: next })}
              options={[{ value: 'all', label: 'Qualquer papel' }, { value: 'admin', label: 'Administradores' }, { value: 'user', label: 'Usuários comuns' }]} />
          </>
        )}
        advanced={(
          <>
            <AdminDateField label="Criada a partir de" value={filters.from} onChange={(from) => update({ from })} />
            <AdminDateField label="Criada até" value={filters.to} onChange={(to) => update({ to })} />
          </>
        )}
        advancedActive={filters.from !== '' || filters.to !== ''}
        summary={list.status === 'ready' && list.items.length > 0 ? `${list.items.length} ${list.items.length === 1 ? 'conta carregada' : 'contas carregadas'}${list.hasMore ? ' — há mais resultados' : ''}` : undefined}
        onClear={active ? clear : undefined}
      />
      <ListChrome list={list} empty="Nenhuma conta encontrada.">
        {mode === 'wide' ? (
          <AdminTable caption="Contas">
            <thead>
              <tr>
                <AdminTh>Usuário</AdminTh><AdminTh>Situação</AdminTh><AdminTh>Papel</AdminTh><AdminTh>Criada em</AdminTh><AdminTh className="text-right">Ações</AdminTh>
              </tr>
            </thead>
            <tbody>
              {list.items.map((u) => (
                <AdminTr key={u.id}>
                  <AdminTd className="max-w-0 w-[40%]"><UserIdentity user={u} from={origin} /></AdminTd>
                  <AdminTd><Badge value={u.status} /></AdminTd>
                  <AdminTd><Badge value={u.role} /></AdminTd>
                  <AdminTd className="whitespace-nowrap">{formatWhen(u.createdAt)}</AdminTd>
                  <AdminTd><RowActions user={u} /></AdminTd>
                </AdminTr>
              ))}
            </tbody>
          </AdminTable>
        ) : (
          <ul className="flex flex-col divide-y divide-white/5 rounded-xl border border-white/10">
            {list.items.map((u) => (
              <li key={u.id} className="flex flex-col gap-2 p-3">
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1"><UserIdentity user={u} from={origin} /></div>
                  <RowActions user={u} />
                </div>
                <div className="flex flex-wrap items-center gap-2 text-caption text-text-muted">
                  <Badge value={u.status} />
                  <Badge value={u.role} />
                  <span>criada em {formatWhen(u.createdAt)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </ListChrome>
    </div>
  );
}

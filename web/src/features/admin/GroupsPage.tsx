import { useCallback } from 'react';
import { Link, useLocation } from 'react-router';
import { History } from 'lucide-react';
import { GroupAvatar } from '@/features/conversations/GroupAvatar';
import { buttonVariants } from '@/shared/ui/primitives/button';
import { useCursorList } from '@/shared/hooks/useCursorList';
import { useUrlSearch } from '@/shared/hooks/useUrlSearch';
import { fetchAdminGroups } from './adminApi';
import type { AdminGroupRow } from './adminApi';
import { formatWhen } from './adminFormat';
import { AdminListToolbar, AdminSelectField } from './AdminListToolbar';
import { AdminTable, AdminTd, AdminTh, AdminTr } from './AdminTable';
import { Badge, ListChrome } from './adminUi';
import { CopyIdButton } from './CopyIdButton';
import { fromList } from './useAdminBack';
import { useAdminMode } from './useAdminMode';
import { useAdminQuery } from './useAdminQuery';
import type { QuerySchema } from './useAdminQuery';

type StatusFilter = 'all' | 'active' | 'suspended' | 'orphan';

const QUERY: QuerySchema<'q' | 'filter'> = {
  q: { default: '' },
  filter: { default: 'all', allowed: ['all', 'active', 'suspended', 'orphan'] },
};

function RowActions({ group }: { group: AdminGroupRow }) {
  const name = group.title || 'grupo sem nome';
  return (
    <div className="flex items-center justify-end gap-0.5">
      <CopyIdButton id={group.id} label={`Copiar ID de ${name}`} />
      <Link to={`/admin/audit?targetId=${encodeURIComponent(group.id)}`} aria-label={`Ver histórico de ${name}`} title="Ver histórico" className={buttonVariants({ variant: 'ghost', size: 'icon-sm' })}>
        <History size={15} aria-hidden />
      </Link>
    </div>
  );
}

function GroupIdentity({ group, from }: { group: AdminGroupRow; from: { from: string } }) {
  return (
    <Link to={`/admin/groups/${group.id}`} state={from} className="flex min-w-0 items-center gap-3 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <GroupAvatar title={group.title} avatar={group.avatar} size={36} />
      <span className="block min-w-0 truncate text-body font-medium text-text-primary">{group.title || 'Grupo sem nome'}</span>
    </Link>
  );
}

/** A group with no owner is a condition, not a status: it gets its own mark so it can't be mistaken for a suspension. */
function Owner({ group }: { group: AdminGroupRow }) {
  if (!group.ownerId) return <span className="inline-flex rounded bg-yellow/15 px-1.5 py-0.5 text-[11px] font-medium text-yellow">Sem dono</span>;
  return <Link to={`/admin/users/${group.ownerId}`} className="block max-w-full truncate text-text-secondary hover:underline">@{group.ownerUsername}</Link>;
}

export function GroupsPage() {
  const { filters, update, clear, active, identity } = useAdminQuery(QUERY);
  const { pathname, search } = useLocation();
  const mode = useAdminMode();
  const { value: query, setValue: setQuery } = useUrlSearch(filters.q, (q) => update({ q }));
  const filter = filters.filter as StatusFilter;
  const fetchPage = useCallback((cursor: string | null) => fetchAdminGroups({
    q: filters.q, status: filter === 'active' || filter === 'suspended' ? filter : undefined, orphan: filter === 'orphan',
  }, cursor), [filters.q, filter]);
  const list = useCursorList(fetchPage, identity, { getKey: (g) => g.id });
  const origin = fromList(pathname, search);

  return (
    <div className="flex flex-col gap-4">
      <AdminListToolbar
        search={{ value: query, onChange: setQuery, placeholder: 'Buscar por nome ou ID', label: 'Buscar grupos' }}
        filters={(
          <AdminSelectField<StatusFilter> label="Estado" value={filter} onChange={(next) => update({ filter: next })}
            options={[{ value: 'all', label: 'Todos' }, { value: 'active', label: 'Ativos' }, { value: 'suspended', label: 'Suspensos' }, { value: 'orphan', label: 'Sem dono' }]} />
        )}
        summary={list.status === 'ready' && list.items.length > 0 ? `${list.items.length} ${list.items.length === 1 ? 'grupo carregado' : 'grupos carregados'}${list.hasMore ? ' — há mais resultados' : ''}` : undefined}
        onClear={active ? clear : undefined}
      />
      <ListChrome list={list} empty="Nenhum grupo encontrado.">
        {mode === 'wide' ? (
          <AdminTable caption="Grupos">
            <thead>
              <tr>
                <AdminTh>Grupo</AdminTh><AdminTh>Situação</AdminTh><AdminTh>Dono</AdminTh><AdminTh>Membros</AdminTh><AdminTh>Criado em</AdminTh><AdminTh className="text-right">Ações</AdminTh>
              </tr>
            </thead>
            <tbody>
              {list.items.map((g) => (
                <AdminTr key={g.id}>
                  <AdminTd className="max-w-0 w-[34%]"><GroupIdentity group={g} from={origin} /></AdminTd>
                  <AdminTd><Badge value={g.status} /></AdminTd>
                  <AdminTd className="max-w-40"><Owner group={g} /></AdminTd>
                  <AdminTd>{g.memberCount}</AdminTd>
                  <AdminTd className="whitespace-nowrap">{formatWhen(g.createdAt)}</AdminTd>
                  <AdminTd><RowActions group={g} /></AdminTd>
                </AdminTr>
              ))}
            </tbody>
          </AdminTable>
        ) : (
          <ul className="flex flex-col divide-y divide-white/5 rounded-xl border border-white/10">
            {list.items.map((g) => (
              <li key={g.id} className="flex flex-col gap-2 p-3">
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1"><GroupIdentity group={g} from={origin} /></div>
                  <RowActions group={g} />
                </div>
                <div className="flex flex-wrap items-center gap-2 text-caption text-text-muted">
                  <Badge value={g.status} />
                  <Owner group={g} />
                  <span>{g.memberCount} {g.memberCount === 1 ? 'membro' : 'membros'}</span>
                  <span>criado em {formatWhen(g.createdAt)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </ListChrome>
    </div>
  );
}

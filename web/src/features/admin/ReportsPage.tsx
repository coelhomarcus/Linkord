import { useCallback } from 'react';
import { Link, useLocation } from 'react-router';
import { Segmented } from '@/features/friends/Segmented';
import { categoryLabel } from '@/features/reports/reportCategories';
import { fetchAdminReports } from './adminApi';
import { formatWhen } from './adminFormat';
import { Badge, ListChrome } from './adminUi';
import { fromList } from './useAdminBack';
import { useAdminList } from './useAdminList';
import { useAdminQuery } from './useAdminQuery';
import type { QuerySchema } from './useAdminQuery';

type Filter = 'open' | 'reviewing' | 'closed';
const QUERY: QuerySchema<'status'> = { status: { default: 'open', allowed: ['open', 'reviewing', 'closed'] } };
const TARGET_LABEL = { user: 'Conta', group: 'Grupo', message: 'Mensagem' } as const;

export function ReportsPage() {
  const { filters, update, identity } = useAdminQuery(QUERY);
  const { pathname, search } = useLocation();
  const filter = filters.status as Filter;
  const fetchPage = useCallback((cursor: string | null) => fetchAdminReports({ status: filter }, cursor), [filter]);
  const list = useAdminList(fetchPage, identity, (r) => r.id);

  return (
    <div className="flex flex-col gap-4">
      <Segmented<Filter> label="Estado da denúncia" value={filter} onChange={(next) => update({ status: next })}
        options={[{ value: 'open', label: 'Abertas' }, { value: 'reviewing', label: 'Em análise' }, { value: 'closed', label: 'Encerradas' }]} />
      <ListChrome list={list} empty="Nenhuma denúncia nesta fila.">
        {list.items.map((r) => (
          <Link key={r.id} to={`/admin/reports/${r.id}`} state={fromList(pathname, search)} className="flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <div className="min-w-0 flex-1">
              <p className="truncate text-body font-medium text-text-primary">{TARGET_LABEL[r.targetType]}: {r.targetLabel || r.targetId}</p>
              <p className="truncate text-caption text-text-muted">{categoryLabel(r.category)} · por {r.reporter ? `@${r.reporter}` : 'conta apagada'} · {formatWhen(r.createdAt)}</p>
            </div>
            <Badge value={r.status} />
          </Link>
        ))}
      </ListChrome>
    </div>
  );
}

import { useCallback, useState } from 'react';
import { Link } from 'react-router';
import { Segmented } from '@/features/friends/Segmented';
import { useCursorList } from '@/features/friends/useCursorList';
import { categoryLabel } from '@/features/reports/reportCategories';
import { fetchAdminReports } from './adminApi';
import { formatWhen } from './adminFormat';
import { Badge, ListChrome } from './adminUi';

type Filter = 'open' | 'reviewing' | 'closed';
const TARGET_LABEL = { user: 'Conta', group: 'Grupo', message: 'Mensagem' } as const;

export function ReportsPage() {
  const [filter, setFilter] = useState<Filter>('open');
  const fetchPage = useCallback((cursor: string | null) => fetchAdminReports({ status: filter }, cursor), [filter]);
  const list = useCursorList(fetchPage, filter);

  return (
    <div className="flex flex-col gap-4">
      <Segmented<Filter> label="Estado da denúncia" value={filter} onChange={setFilter}
        options={[{ value: 'open', label: 'Abertas' }, { value: 'reviewing', label: 'Em análise' }, { value: 'closed', label: 'Encerradas' }]} />
      <ListChrome list={list} empty="Nenhuma denúncia nesta fila.">
        {list.items.map((r) => (
          <Link key={r.id} to={`/admin/reports/${r.id}`} className="flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
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

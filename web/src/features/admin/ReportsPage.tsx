import { useCallback } from 'react';
import { Link, useLocation } from 'react-router';
import { categoryLabel } from '@/features/reports/reportCategories';
import { fetchAdminReports } from './adminApi';
import type { AdminReportRow } from './adminApi';
import { REPORT_TARGET_LABEL, formatWhen } from './adminFormat';
import { AdminListToolbar, AdminSelectField } from './AdminListToolbar';
import { AdminTable, AdminTd, AdminTh, AdminTr } from './AdminTable';
import { Badge, ListChrome } from './adminUi';
import { fromList } from './useAdminBack';
import { useAdminList } from './useAdminList';
import { useAdminMode } from './useAdminMode';
import { useAdminQuery } from './useAdminQuery';
import type { QuerySchema } from './useAdminQuery';

type Queue = 'open' | 'reviewing' | 'closed';
type TargetFilter = 'all' | 'user' | 'group' | 'message';

const QUERY: QuerySchema<'status' | 'targetType'> = {
  status: { default: 'open', allowed: ['open', 'reviewing', 'closed'] },
  targetType: { default: 'all', allowed: ['all', 'user', 'group', 'message'] },
};

function ReportLink({ report, from }: { report: AdminReportRow; from: { from: string } }) {
  return (
    <Link to={`/admin/reports/${report.id}`} state={from} className="block min-w-0 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <span className="block truncate text-body font-medium text-text-primary">{report.targetLabel || report.targetId}</span>
      <span className="block truncate text-caption text-text-muted">{REPORT_TARGET_LABEL[report.targetType]}</span>
    </Link>
  );
}

const assignee = (report: AdminReportRow) => (report.assignee ? `@${report.assignee}` : '—');

export function ReportsPage() {
  const { filters, update, clear, active, identity } = useAdminQuery(QUERY);
  const { pathname, search } = useLocation();
  const mode = useAdminMode();
  const queue = filters.status as Queue;
  const target = filters.targetType as TargetFilter;
  const fetchPage = useCallback((cursor: string | null) => fetchAdminReports({
    status: queue, targetType: target === 'all' ? undefined : target,
  }, cursor), [queue, target]);
  const list = useAdminList(fetchPage, identity, (r) => r.id);
  const origin = fromList(pathname, search);

  return (
    <div className="flex flex-col gap-4">
      <AdminListToolbar
        filters={(
          <>
            <AdminSelectField<Queue> label="Fila" value={queue} onChange={(next) => update({ status: next })}
              options={[{ value: 'open', label: 'Abertas' }, { value: 'reviewing', label: 'Em análise' }, { value: 'closed', label: 'Encerradas' }]} />
            <AdminSelectField<TargetFilter> label="Tipo de alvo" value={target} onChange={(next) => update({ targetType: next })}
              options={[{ value: 'all', label: 'Todos' }, { value: 'user', label: 'Contas' }, { value: 'group', label: 'Grupos' }, { value: 'message', label: 'Mensagens' }]} />
          </>
        )}
        summary={list.status === 'ready' && list.items.length > 0 ? `${list.items.length} ${list.items.length === 1 ? 'denúncia carregada' : 'denúncias carregadas'}${list.hasMore ? ' — há mais resultados' : ''}` : undefined}
        onClear={active ? clear : undefined}
      />
      <ListChrome list={list} empty="Nenhuma denúncia nesta fila.">
        {mode === 'wide' ? (
          <AdminTable caption="Denúncias">
            <thead>
              <tr>
                <AdminTh>Alvo</AdminTh><AdminTh>Categoria</AdminTh><AdminTh>Situação</AdminTh><AdminTh>Responsável</AdminTh><AdminTh>Recebida em</AdminTh>
              </tr>
            </thead>
            <tbody>
              {list.items.map((r) => (
                <AdminTr key={r.id}>
                  <AdminTd className="max-w-0 w-[34%]"><ReportLink report={r} from={origin} /></AdminTd>
                  <AdminTd>{categoryLabel(r.category)}</AdminTd>
                  <AdminTd><Badge value={r.status} /></AdminTd>
                  <AdminTd className="max-w-40 truncate">{assignee(r)}</AdminTd>
                  <AdminTd className="whitespace-nowrap">{formatWhen(r.createdAt)}</AdminTd>
                </AdminTr>
              ))}
            </tbody>
          </AdminTable>
        ) : (
          <ul className="flex flex-col divide-y divide-white/5 rounded-xl border border-white/10">
            {list.items.map((r) => (
              <li key={r.id} className="flex flex-col gap-2 p-3">
                <ReportLink report={r} from={origin} />
                <div className="flex flex-wrap items-center gap-2 text-caption text-text-muted">
                  <Badge value={r.status} />
                  <span>{categoryLabel(r.category)}</span>
                  <span>responsável: {assignee(r)}</span>
                  <span>{formatWhen(r.createdAt)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </ListChrome>
    </div>
  );
}

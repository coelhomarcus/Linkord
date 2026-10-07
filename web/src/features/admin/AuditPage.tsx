import { useCallback, useState } from 'react';
import { Link } from 'react-router';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useUrlSearch } from '@/shared/hooks/useUrlSearch';
import { fetchAudit } from './adminApi';
import type { AuditRow } from './adminApi';
import { ACTION_LABELS, dayStartIso, formatWhenShort, nextDayStartIso } from './adminFormat';
import { AdminDateField, AdminListToolbar, AdminSelectField } from './AdminListToolbar';
import { AuditRowDetails } from './AuditRowDetails';
import { AdminTable, AdminTd, AdminTh, AdminTr } from './AdminTable';
import { ListChrome } from './adminUi';
import { useAdminList } from './useAdminList';
import { useAdminTableFits } from './useAdminMode';
import { useAdminQuery } from './useAdminQuery';
import type { QuerySchema } from './useAdminQuery';

const TARGET_TYPES = ['all', 'user', 'group', 'message', 'report', 'system'] as const;
const TARGET_TYPE_LABEL: Record<string, string> = { user: 'Conta', group: 'Grupo', message: 'Mensagem', report: 'Denúncia', system: 'Sistema' };

const QUERY: QuerySchema<'action' | 'actor' | 'targetType' | 'targetId' | 'from' | 'to'> = {
  action: { default: '' },
  actor: { default: '' },
  targetType: { default: 'all', allowed: TARGET_TYPES },
  targetId: { default: '' },
  from: { default: '' },
  to: { default: '' },
};

const ACTION_OPTIONS = Object.entries(ACTION_LABELS).sort((a, b) => a[1].localeCompare(b[1], 'pt-BR')).map(([value, label]) => ({ value, label }));
const TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Where an admin page for the entity lives — unless the record is the entity's own deletion. */
function entityHref(type: string, id: string, action: string): string | null {
  if (!id || action.endsWith('.delete')) return null;
  if (type === 'user') return `/admin/users/${encodeURIComponent(id)}`;
  if (type === 'group') return `/admin/groups/${encodeURIComponent(id)}`;
  if (type === 'report') return `/admin/reports/${encodeURIComponent(id)}`;
  return null;
}

function Result({ row }: { row: AuditRow }) {
  return row.result === 'failed'
    ? <span className="inline-flex rounded bg-red/15 px-1.5 py-0.5 text-[11px] font-medium text-red-text">Falhou</span>
    : <span className="inline-flex rounded bg-green/15 px-1.5 py-0.5 text-[11px] font-medium text-green">Concluída</span>;
}

function Actor({ row }: { row: AuditRow }) {
  if (!row.actorLabel && !row.actorId) return <span className="text-text-muted">sistema</span>;
  const label = row.actorLabel || row.actorId || '';
  return row.actorId
    ? <Link to={`/admin/users/${encodeURIComponent(row.actorId)}`} className="hover:underline">{label}</Link>
    : <span>{label}</span>;
}

function Target({ row, inline }: { row: AuditRow; inline?: boolean }) {
  const href = entityHref(row.targetType, row.targetId, row.action);
  const label = row.targetLabel || row.targetId || '—';
  const name = href ? <Link to={href} className="hover:underline">{label}</Link> : <span>{label}</span>;
  if (inline) return <span className="min-w-0 break-words">{TARGET_TYPE_LABEL[row.targetType] ?? row.targetType}: {name}</span>;
  return (
    <span className="min-w-0">
      <span className="block text-caption text-text-muted">{TARGET_TYPE_LABEL[row.targetType] ?? row.targetType}</span>
      {href ? <Link to={href} className="block truncate hover:underline">{label}</Link> : <span className="block truncate">{label}</span>}
    </span>
  );
}

function Toggle({ row, open, onToggle, controls }: { row: AuditRow; open: boolean; onToggle: () => void; controls: string }) {
  return (
    <button type="button" aria-expanded={open} aria-controls={controls} onClick={onToggle} className="flex items-center gap-1.5 rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-ring">
      {open ? <ChevronDown size={14} aria-hidden className="flex-none text-text-muted" /> : <ChevronRight size={14} aria-hidden className="flex-none text-text-muted" />}
      <span>{formatWhenShort(row.at)}</span>
      <span className="sr-only">: detalhes de {ACTION_LABELS[row.action] ?? row.action}</span>
    </button>
  );
}

function WideRow({ row }: { row: AuditRow }) {
  const [open, setOpen] = useState(false);
  const detailsId = `audit-${row.id}`;
  return (
    <>
      <AdminTr>
        <AdminTd><Toggle row={row} open={open} onToggle={() => setOpen((v) => !v)} controls={detailsId} /></AdminTd>
        <AdminTd className="font-medium text-text-primary">{ACTION_LABELS[row.action] ?? row.action}</AdminTd>
        <AdminTd className="truncate"><Actor row={row} /></AdminTd>
        <AdminTd className="truncate"><Target row={row} /></AdminTd>
        <AdminTd><Result row={row} /></AdminTd>
      </AdminTr>
      {open && (
        <tr id={detailsId} className="bg-white/[0.02]">
          <td colSpan={5} className="border-b border-white/5 px-6 py-3"><AuditRowDetails row={row} /></td>
        </tr>
      )}
    </>
  );
}

function CompactRow({ row }: { row: AuditRow }) {
  const [open, setOpen] = useState(false);
  const detailsId = `audit-${row.id}`;
  return (
    <li className="flex flex-col gap-2 p-3 text-label text-text-secondary">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium text-text-primary">{ACTION_LABELS[row.action] ?? row.action}</span>
        <Result row={row} />
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-caption">
        <span>por <Actor row={row} /></span>
        <span>alvo: <Target row={row} inline /></span>
      </div>
      <Toggle row={row} open={open} onToggle={() => setOpen((v) => !v)} controls={detailsId} />
      {open && <div id={detailsId} className="rounded-lg bg-white/[0.03] p-3"><AuditRowDetails row={row} /></div>}
    </li>
  );
}

/** Read-only by construction: there is no edit or delete anywhere in this
 * feature or its API. A record is shown as it was written. */
export function AuditPage() {
  const { filters, update, clear, active, identity } = useAdminQuery(QUERY);
  const tableFits = useAdminTableFits();
  const action = filters.action;
  const actor = useUrlSearch(filters.actor, (next) => update({ actor: next }));
  const target = useUrlSearch(filters.targetId, (next) => update({ targetId: next }));
  const { from, to } = filters;
  const fetchPage = useCallback((cursor: string | null) => fetchAudit({
    action: filters.action, actor: filters.actor, targetId: filters.targetId,
    targetType: filters.targetType === 'all' ? undefined : filters.targetType,
    from: dayStartIso(from),
    // the server's upper bound is exclusive: "up to this day" is the start of the next one
    to: nextDayStartIso(to),
  }, cursor), [filters.action, filters.actor, filters.targetId, filters.targetType, from, to]);
  const list = useAdminList(fetchPage, identity, (row) => row.id);

  // a code the labels don't know (a link, an older record) is kept, not silently reset
  const actionOptions = [{ value: '', label: 'Todas as ações' }, ...(action && !ACTION_LABELS[action] ? [{ value: action, label: `${action} (código desconhecido)` }] : []), ...ACTION_OPTIONS];
  const field = 'h-9 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 text-label text-text-primary outline-none focus-visible:ring-2 focus-visible:ring-ring';

  return (
    <div className="flex flex-col gap-4">
      <AdminListToolbar
        filters={(
          <>
            <AdminSelectField<string> label="Ação" value={action} onChange={(next) => update({ action: next })} options={actionOptions} />
            <AdminSelectField<string> label="Tipo de alvo" value={filters.targetType} onChange={(next) => update({ targetType: next })}
              options={[{ value: 'all', label: 'Todos' }, ...TARGET_TYPES.filter((t) => t !== 'all').map((t) => ({ value: t, label: TARGET_TYPE_LABEL[t]! }))]} />
            <label className="flex min-w-40 flex-1 flex-col gap-1 text-caption text-text-muted">
              Administrador
              <input aria-label="Administrador" placeholder="Usuário ou ID" value={actor.value} onChange={(e) => actor.setValue(e.target.value)} className={field} />
            </label>
            <label className="flex min-w-40 flex-1 flex-col gap-1 text-caption text-text-muted">
              ID do alvo
              <input aria-label="ID do alvo" placeholder="ID exato" value={target.value} onChange={(e) => target.setValue(e.target.value)} className={field} />
            </label>
          </>
        )}
        advanced={(
          <>
            <AdminDateField label="De" value={from} onChange={(next) => update({ from: next })} />
            <AdminDateField label="Até (inclusive)" value={to} onChange={(next) => update({ to: next })} />
            <p className="self-end pb-2 text-caption text-text-muted">Dias no fuso {TIME_ZONE}.</p>
          </>
        )}
        advancedActive={from !== '' || to !== ''}
        summary={list.status === 'ready' && list.items.length > 0 ? `${list.items.length} ${list.items.length === 1 ? 'registro carregado' : 'registros carregados'}${list.hasMore ? ' — há mais registros' : ''}` : undefined}
        onClear={active ? clear : undefined}
      />
      <ListChrome list={list} empty="Nenhum registro para esses filtros.">
        {tableFits ? (
          <AdminTable caption="Registros de auditoria" className="min-w-[560px] table-fixed">
            <thead>
              <tr>
                <AdminTh className="w-[22%]">Quando</AdminTh><AdminTh className="w-[18%]">Ação</AdminTh><AdminTh className="w-[21%]">Administrador</AdminTh><AdminTh className="w-[23%]">Alvo</AdminTh><AdminTh className="w-[16%]">Resultado</AdminTh>
              </tr>
            </thead>
            <tbody>{list.items.map((row) => <WideRow key={row.id} row={row} />)}</tbody>
          </AdminTable>
        ) : (
          <ul className="flex flex-col divide-y divide-white/5 rounded-xl border border-white/10">{list.items.map((row) => <CompactRow key={row.id} row={row} />)}</ul>
        )}
      </ListChrome>
    </div>
  );
}

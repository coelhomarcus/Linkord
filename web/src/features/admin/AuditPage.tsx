import { useCallback, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useUrlSearch } from '@/shared/hooks/useUrlSearch';
import { Button } from '@/shared/ui/primitives/button';
import { Input } from '@/shared/ui/primitives/input';
import { fetchAudit } from './adminApi';
import type { AuditRow } from './adminApi';
import { ACTION_LABELS, dayStartIso, formatWhen, nextDayStartIso } from './adminFormat';
import { ListChrome } from './adminUi';
import { useAdminList } from './useAdminList';
import { useAdminQuery } from './useAdminQuery';
import type { QuerySchema } from './useAdminQuery';

function Row({ row }: { row: AuditRow }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-white/5 py-2">
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="flex w-full items-start gap-2 text-left">
        {open ? <ChevronDown size={14} className="mt-1 flex-none text-text-muted" /> : <ChevronRight size={14} className="mt-1 flex-none text-text-muted" />}
        <div className="min-w-0 flex-1">
          <p className="text-label text-text-primary">
            <span className="font-medium">{ACTION_LABELS[row.action] ?? row.action}</span>
            {row.result === 'failed' && <span className="ml-2 rounded bg-red/15 px-1.5 py-0.5 text-[11px] font-medium text-red-text">falhou</span>}
          </p>
          <p className="truncate text-caption text-text-muted">{formatWhen(row.at)} · {row.actorLabel || 'sistema'} → {row.targetType}{row.targetLabel ? ` ${row.targetLabel}` : ''}</p>
        </div>
      </button>
      {open && (
        <dl className="ml-6 mt-2 grid grid-cols-1 gap-1 text-caption text-text-muted sm:grid-cols-2">
          <div>Motivo: <span className="text-text-secondary">{row.reason || '—'}</span></div>
          <div>Alvo (id): <span className="break-all text-text-secondary">{row.targetId || '—'}</span></div>
          <div>Request: <span className="break-all text-text-secondary">{row.requestId || '—'}</span></div>
          <div className="sm:col-span-2">Detalhes: <span className="break-all font-mono text-text-secondary">{JSON.stringify(row.detail)}</span></div>
        </dl>
      )}
    </div>
  );
}

const QUERY: QuerySchema<'action' | 'actor' | 'targetId' | 'from' | 'to'> = {
  action: { default: '' }, actor: { default: '' }, targetId: { default: '' }, from: { default: '' }, to: { default: '' },
};

/** Read-only by construction: there is no edit or delete anywhere in this
 * feature or its API. */
export function AuditPage() {
  const { filters, update, clear, active, identity } = useAdminQuery(QUERY);
  const action = useUrlSearch(filters.action, (next) => update({ action: next }));
  const actor = useUrlSearch(filters.actor, (next) => update({ actor: next }));
  const target = useUrlSearch(filters.targetId, (next) => update({ targetId: next }));
  const { from, to } = filters;
  const fetchPage = useCallback((cursor: string | null) => fetchAudit({
    action: filters.action, actor: filters.actor, targetId: filters.targetId,
    from: dayStartIso(from),
    // the server's upper bound is exclusive: "up to this day" is the start of the next one
    to: nextDayStartIso(to),
  }, cursor), [filters.action, filters.actor, filters.targetId, from, to]);
  const list = useAdminList(fetchPage, identity, (row) => row.id);
  const field = 'h-9 border-white/10 bg-white/[0.04] text-label';

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <Input aria-label="Ação" placeholder="Ação (ex.: user.suspend)" value={action.value} onChange={(e) => action.setValue(e.target.value)} className={field} />
        <Input aria-label="Ator" placeholder="Ator (usuário ou id)" value={actor.value} onChange={(e) => actor.setValue(e.target.value)} className={field} />
        <Input aria-label="Alvo" placeholder="ID do alvo" value={target.value} onChange={(e) => target.setValue(e.target.value)} className={field} />
        <Input aria-label="De" type="date" value={from} onChange={(e) => update({ from: e.target.value })} className={field} />
        <Input aria-label="Até" type="date" value={to} onChange={(e) => update({ to: e.target.value })} className={field} />
      </div>
      <ListChrome list={list} empty="Nenhum registro para esses filtros." emptyAction={active ? <Button type="button" variant="secondary" size="sm" onClick={clear}>Limpar filtros</Button> : undefined}>
        {list.items.map((row) => <Row key={row.id} row={row} />)}
      </ListChrome>
    </div>
  );
}

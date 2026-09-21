import { useCallback, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useCursorList } from '@/features/friends/useCursorList';
import { useDebouncedValue } from '@/features/friends/useDebouncedValue';
import { Input } from '@/shared/ui/primitives/input';
import { fetchAudit } from './adminApi';
import type { AuditRow } from './adminApi';
import { ACTION_LABELS, formatWhen } from './adminFormat';
import { ListChrome } from './adminUi';

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

/** Read-only by construction: there is no edit or delete anywhere in this
 * feature or its API. */
export function AuditPage() {
  const [action, setAction] = useState('');
  const [actor, setActor] = useState('');
  const [targetId, setTargetId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const debounced = useDebouncedValue(`${action}|${actor}|${targetId}`, 300);
  const fetchPage = useCallback((cursor: string | null) => {
    const [a, who, target] = debounced.split('|');
    return fetchAudit({
      action: a?.trim(), actor: who?.trim(), targetId: target?.trim(),
      from: from ? new Date(`${from}T00:00:00`).toISOString() : undefined,
      to: to ? new Date(`${to}T23:59:59.999`).toISOString() : undefined,
    }, cursor);
  }, [debounced, from, to]);
  const list = useCursorList(fetchPage, `${debounced}|${from}|${to}`);
  const field = 'h-9 border-white/10 bg-white/[0.04] text-label';

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <Input aria-label="Ação" placeholder="Ação (ex.: user.suspend)" value={action} onChange={(e) => setAction(e.target.value)} className={field} />
        <Input aria-label="Ator" placeholder="Ator (usuário ou id)" value={actor} onChange={(e) => setActor(e.target.value)} className={field} />
        <Input aria-label="Alvo" placeholder="ID do alvo" value={targetId} onChange={(e) => setTargetId(e.target.value)} className={field} />
        <Input aria-label="De" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={field} />
        <Input aria-label="Até" type="date" value={to} onChange={(e) => setTo(e.target.value)} className={field} />
      </div>
      <ListChrome list={list} empty="Nenhum registro para esses filtros.">
        {list.items.map((row) => <Row key={row.id} row={row} />)}
      </ListChrome>
    </div>
  );
}

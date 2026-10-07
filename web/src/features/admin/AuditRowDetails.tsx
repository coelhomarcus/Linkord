import type { ReactNode } from 'react';
import { formatFileSize } from '@/shared/lib/formatBytes';
import type { AuditRow } from './adminApi';
import { ACTION_LABELS, REPORT_RESOLUTION_LABEL } from './adminFormat';
import { AdminFieldRow, AdminFields } from './AdminSection';

/** Past this, the raw JSON is cut: a metadata blob must not take over the screen. */
const JSON_LIMIT = 2000;

const KEY_LABELS: Record<string, string> = {
  resolution: 'Desfecho',
  newOwnerId: 'Novo dono (ID)',
  previousOwnerIds: 'Donos anteriores (IDs)',
  deleted: 'Apagados',
  failed: 'Falhas',
  orphanBytes: 'Tamanho dos órfãos',
  missingFiles: 'Registros sem arquivo',
};

type Primitive = string | number | boolean;
const isPrimitive = (value: unknown): value is Primitive => ['string', 'number', 'boolean'].includes(typeof value);

function renderValue(key: string, value: Primitive | Primitive[]): ReactNode {
  if (Array.isArray(value)) return value.length === 0 ? '—' : <span className="break-all">{value.join(', ')}</span>;
  if (key === 'resolution' && typeof value === 'string') return REPORT_RESOLUTION_LABEL[value] ?? value;
  if (key === 'orphanBytes' && typeof value === 'number') return formatFileSize(value);
  if (typeof value === 'boolean') return value ? 'sim' : 'não';
  return <span className="break-all">{String(value)}</span>;
}

/** Known, flat metadata becomes labelled rows; whatever is nested or unfamiliar
 * stays available as formatted JSON behind a disclosure — never dropped, never
 * dumped inline. */
function splitDetail(detail: Record<string, unknown>): { pairs: { key: string; label: string; value: ReactNode }[]; rest: Record<string, unknown> | null } {
  const pairs: { key: string; label: string; value: ReactNode }[] = [];
  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(detail)) {
    if (isPrimitive(value) || (Array.isArray(value) && value.every(isPrimitive))) {
      pairs.push({ key, label: KEY_LABELS[key] ?? key, value: renderValue(key, value) });
    } else {
      rest[key] = value;
    }
  }
  return { pairs, rest: Object.keys(rest).length > 0 ? rest : null };
}

function RawJson({ value }: { value: Record<string, unknown> }) {
  const text = JSON.stringify(value, null, 2);
  const cut = text.length > JSON_LIMIT;
  return (
    <details className="text-caption text-text-muted">
      <summary className="cursor-pointer select-none py-1">Ver dados brutos</summary>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-black/30 p-3 font-mono text-text-secondary">{cut ? `${text.slice(0, JSON_LIMIT)}\n…` : text}</pre>
      {cut && <p className="mt-1">Mostrando os primeiros {JSON_LIMIT} caracteres.</p>}
    </details>
  );
}

/** Everything a record carries that the row itself doesn't show. */
export function AuditRowDetails({ row }: { row: AuditRow }) {
  const { pairs, rest } = splitDetail(row.detail);
  return (
    <div className="flex flex-col gap-2">
      <AdminFields>
        <AdminFieldRow label="Motivo">{row.reason || '—'}</AdminFieldRow>
        <AdminFieldRow label="Código da ação"><span className="font-mono text-caption">{row.action}</span>{ACTION_LABELS[row.action] ? '' : ' (sem rótulo conhecido)'}</AdminFieldRow>
        <AdminFieldRow label="ID do alvo"><span className="break-all font-mono text-caption">{row.targetId || '—'}</span></AdminFieldRow>
        <AdminFieldRow label="ID da requisição"><span className="break-all font-mono text-caption">{row.requestId || '—'}</span></AdminFieldRow>
        {pairs.map((pair) => <AdminFieldRow key={pair.key} label={pair.label}>{pair.value}</AdminFieldRow>)}
      </AdminFields>
      {rest && <RawJson value={rest} />}
    </div>
  );
}

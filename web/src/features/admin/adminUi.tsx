import type { ReactNode } from 'react';
import { Button } from '@/shared/ui/primitives/button';
import { cn } from '@/shared/lib/utils';
import type { AuditRow } from './adminApi';
import { ACTION_LABELS, formatWhen } from './adminFormat';

const TONES: Record<string, string> = {
  active: 'bg-green/15 text-green', suspended: 'bg-red/15 text-red-text',
  open: 'bg-yellow/15 text-yellow', reviewing: 'bg-primary/15 text-primary',
  resolved: 'bg-green/15 text-green', dismissed: 'bg-white/10 text-text-muted',
  admin: 'bg-primary/15 text-primary', user: 'bg-white/10 text-text-muted',
};
const LABELS: Record<string, string> = {
  active: 'Ativo', suspended: 'Suspenso', open: 'Aberta', reviewing: 'Em análise', resolved: 'Resolvida', dismissed: 'Dispensada',
  admin: 'Admin', user: 'Usuário',
};

export function Badge({ value }: { value: string }) {
  return <span className={cn('inline-flex flex-none rounded px-1.5 py-0.5 text-[11px] font-medium', TONES[value] ?? 'bg-white/10 text-text-muted')}>{LABELS[value] ?? value}</span>;
}

export function AuditList({ items, empty = 'Nenhuma ação registrada.' }: { items: AuditRow[]; empty?: string }) {
  if (items.length === 0) return <p className="py-4 text-label text-text-muted">{empty}</p>;
  return (
    <ul className="flex flex-col divide-y divide-white/5">
      {items.map((row) => (
        <li key={row.id} className="flex flex-col gap-0.5 py-2.5 text-label">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-text-primary">{ACTION_LABELS[row.action] ?? row.action}</span>
            {row.result === 'failed' && <span className="rounded bg-red/15 px-1.5 py-0.5 text-[11px] font-medium text-red-text">falhou</span>}
            <span className="text-caption text-text-muted">{formatWhen(row.at)}</span>
          </div>
          <p className="text-caption text-text-muted">
            por {row.actorLabel || 'sistema'}{row.targetLabel ? ` · alvo: ${row.targetLabel}` : ''}
          </p>
          {row.reason && <p className="text-caption text-text-secondary">“{row.reason}”</p>}
        </li>
      ))}
    </ul>
  );
}

/** Loading / error / empty / "load more" chrome shared by every admin table. */
export function ListChrome({ list, empty, children }: {
  list: { status: 'loading' | 'error' | 'ready'; items: unknown[]; hasMore: boolean; loadingMore: boolean; loadMore: () => void; retry: () => void };
  empty: string;
  children: ReactNode;
}) {
  if (list.status === 'loading') return <p className="py-8 text-center text-label text-text-muted">Carregando…</p>;
  if (list.status === 'error') {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <p className="text-body text-text-muted">Não foi possível carregar.</p>
        <Button type="button" variant="secondary" size="sm" onClick={list.retry}>Tentar de novo</Button>
      </div>
    );
  }
  if (list.items.length === 0) return <p className="py-10 text-center text-label text-text-muted">{empty}</p>;
  return (
    <>
      <div className="flex flex-col">{children}</div>
      {list.hasMore && (
        <Button type="button" variant="ghost" size="sm" className="mt-2 self-center" disabled={list.loadingMore} onClick={list.loadMore}>
          {list.loadingMore ? 'Carregando…' : 'Carregar mais'}
        </Button>
      )}
    </>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <h2 className="text-label font-medium text-text-secondary">{title}</h2>
      {children}
    </section>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-caption text-text-muted">{label}</dt>
      <dd className="min-w-0 break-words text-label text-text-primary">{children}</dd>
    </div>
  );
}

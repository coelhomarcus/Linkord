import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Button } from '@/shared/ui/primitives/button';
import { cn } from '@/shared/lib/utils';
import type { AuditRow } from './adminApi';
import { ACTION_LABELS, formatWhen } from './adminFormat';
import type { AdminDetailStatus } from './useAdminDetail';

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

interface ChromeList {
  status: 'loading' | 'error' | 'ready';
  items: unknown[];
  hasMore: boolean;
  loadingMore: boolean;
  loadMoreError: boolean;
  refreshing: boolean;
  stale: boolean;
  loadMore: () => void;
  retry: () => void;
}

/** Loading / error / empty / "load more" chrome shared by every admin table.
 * Every state `useCursorList` can be in has a face here: a failed next page and
 * a failed re-read never replace the rows already on screen. */
export function ListChrome({ list, empty, emptyAction, children }: {
  list: ChromeList;
  empty: string;
  /** shown under the empty message (e.g. "Limpar filtros") */
  emptyAction?: ReactNode;
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
  if (list.items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <p className="text-label text-text-muted">{empty}</p>
        {emptyAction}
      </div>
    );
  }
  return (
    <>
      {list.stale && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-yellow/30 bg-yellow/10 px-3 py-2 text-label text-text-primary">
          <p className="min-w-0 flex-1">Não foi possível atualizar a lista. Estes dados podem estar desatualizados.</p>
          <Button type="button" variant="secondary" size="sm" disabled={list.refreshing} onClick={list.retry}>{list.refreshing ? 'Atualizando…' : 'Atualizar'}</Button>
        </div>
      )}
      <div className="flex flex-col">{children}</div>
      {list.loadMoreError && <p role="alert" className="text-center text-caption text-red-text">Não foi possível carregar mais.</p>}
      {list.hasMore && (
        <Button type="button" variant="ghost" size="sm" className="mt-2 self-center" disabled={list.loadingMore} onClick={list.loadMore}>
          {list.loadingMore ? 'Carregando…' : list.loadMoreError ? 'Tentar de novo' : 'Carregar mais'}
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

/** What a detail page shows until it has data: loading, "gone", or a failed read
 * with a retry. Renders nothing once the data is there. */
export function DetailStatusView({ status, missing, failed, backTo, backLabel, onRetry }: {
  status: AdminDetailStatus;
  /** "Conta não encontrada." */
  missing: string;
  /** "Não foi possível carregar a conta." */
  failed: string;
  backTo: string;
  backLabel: string;
  onRetry: () => void;
}) {
  if (status === 'loading') return <p className="py-8 text-center text-label text-text-muted">Carregando…</p>;
  if (status === 'missing') {
    return <p className="py-8 text-center text-label text-text-muted">{missing} <Link to={backTo} className="underline">{backLabel}</Link></p>;
  }
  if (status === 'error') {
    return (
      <div className="flex flex-col items-center gap-3 py-8">
        <p className="text-body text-text-muted">{failed}</p>
        <Button type="button" variant="secondary" size="sm" onClick={onRetry}>Tentar de novo</Button>
      </div>
    );
  }
  return null;
}

/** After a mutation succeeded but the follow-up read failed: the action is DONE,
 * only the view is old — the retry is a read, never the mutation. */
export function RefreshFailedNotice({ refreshing, onRetry }: { refreshing: boolean; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-yellow/30 bg-yellow/10 px-3 py-2 text-label text-text-primary">
      <p className="min-w-0 flex-1">Ação concluída, mas não foi possível atualizar os dados. O que você vê pode estar desatualizado.</p>
      <Button type="button" variant="secondary" size="sm" disabled={refreshing} onClick={onRetry}>{refreshing ? 'Atualizando…' : 'Atualizar'}</Button>
    </div>
  );
}

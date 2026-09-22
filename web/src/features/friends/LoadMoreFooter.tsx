import { Button } from '@/shared/ui/primitives/button';

interface ListLike { hasMore: boolean; loadingMore: boolean; loadMoreError: boolean; loadMore: () => void; stale: boolean; retry: () => void }

/** What sits under a paginated list: the next page, a failed next page (the rows
 * above stay), and a list that couldn't be refreshed. */
export function LoadMoreFooter({ list, className }: { list: ListLike; className?: string }) {
  if (!list.hasMore && !list.loadMoreError && !list.stale) return null;
  return (
    <div className={`flex flex-col items-center gap-2 ${className ?? ''}`}>
      {list.stale && (
        <p role="status" className="flex items-center gap-2 text-caption text-text-muted">
          <span>Não foi possível atualizar a lista.</span>
          <button type="button" onClick={list.retry} className="font-medium underline-offset-2 hover:underline">Tentar de novo</button>
        </p>
      )}
      {list.loadMoreError && <p role="alert" className="text-caption text-red-text">Não foi possível carregar mais.</p>}
      {(list.hasMore || list.loadMoreError) && (
        <Button type="button" variant="ghost" size="sm" disabled={list.loadingMore} onClick={list.loadMore}>
          {list.loadingMore ? 'Carregando…' : list.loadMoreError ? 'Tentar de novo' : 'Carregar mais'}
        </Button>
      )}
    </div>
  );
}

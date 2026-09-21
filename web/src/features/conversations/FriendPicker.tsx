import { useCallback, useState } from 'react';
import { Check, Search } from 'lucide-react';
import { Avatar } from '@/shared/Avatar';
import { Button } from '@/shared/ui/primitives/button';
import { cn } from '@/shared/lib/utils';
import { fetchFriends } from '@/shared/api/api';
import type { SocialUser } from '@/shared/api/api';
import { useCursorList } from '@/features/friends/useCursorList';
import { useDebouncedValue } from '@/features/friends/useDebouncedValue';

interface FriendPickerProps {
  selected: Map<string, SocialUser>;
  onToggle: (user: SocialUser) => void;
  /** Members and users with a pending invite — they can't be invited again. */
  excludeIds?: Set<string>;
  inputId?: string;
  maxHeightClass?: string;
}

/** Paginated friend list with search. Selection lives in the parent as a Map
 * (not derived from the visible page) so it survives searching and paging. */
export function FriendPicker({ selected, onToggle, excludeIds, inputId, maxHeightClass = 'max-h-72' }: FriendPickerProps) {
  const [query, setQuery] = useState('');
  const debounced = useDebouncedValue(query.trim(), 250);
  const fetchPage = useCallback((cursor: string | null) => fetchFriends(cursor, debounced), [debounced]);
  const list = useCursorList(fetchPage, debounced);
  const visible = list.items.filter(({ user }) => !excludeIds?.has(user.id));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3">
        <Search size={15} className="text-text-muted" />
        <input
          id={inputId}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar amigos"
          className="h-9 min-w-0 flex-1 bg-transparent text-label outline-none placeholder:text-text-muted"
        />
      </div>
      <div className={cn('overflow-y-auto rounded-lg border border-white/10 bg-black/20 p-1', maxHeightClass)}>
        {list.status === 'loading' ? (
          <p className="px-3 py-8 text-center text-label text-text-muted">Carregando amigos…</p>
        ) : list.status === 'error' ? (
          <div className="flex flex-col items-center gap-2 px-3 py-6">
            <p className="text-label text-text-muted">Não foi possível carregar seus amigos.</p>
            <Button type="button" variant="secondary" size="sm" onClick={list.retry}>Tentar de novo</Button>
          </div>
        ) : visible.length === 0 ? (
          <p className="px-3 py-8 text-center text-label text-text-muted">
            {debounced ? 'Nenhum amigo encontrado.' : 'Você não tem amigos para convidar.'}
          </p>
        ) : (
          visible.map(({ user }) => {
            const checked = selected.has(user.id);
            return (
              <button
                key={user.id}
                type="button"
                aria-pressed={checked}
                onClick={() => onToggle(user)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors',
                  checked ? 'bg-primary/12 text-text-primary' : 'text-text-secondary hover:bg-white/[0.05]',
                )}
              >
                <Avatar id={user.id} name={user.displayName} avatar={user.avatar} avatarColor={user.avatarColor} size={34} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-label font-medium">{user.displayName}</span>
                  <span className="block truncate text-caption text-text-muted">@{user.username}</span>
                </span>
                <span className={cn(
                  'grid size-5 place-items-center rounded-full border text-[11px]',
                  checked ? 'border-primary bg-primary text-primary-foreground' : 'border-white/15',
                )}>
                  {checked ? <Check size={12} /> : null}
                </span>
              </button>
            );
          })
        )}
        {list.hasMore && (
          <Button type="button" variant="ghost" size="sm" className="mx-auto my-1 flex" disabled={list.loadingMore} onClick={list.loadMore}>
            {list.loadingMore ? 'Carregando…' : 'Carregar mais'}
          </Button>
        )}
      </div>
    </div>
  );
}

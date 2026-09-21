import { useCallback } from 'react';
import { Button } from '@/shared/ui/primitives/button';
import { Avatar } from '@/shared/Avatar';
import { GroupAvatar } from '@/features/conversations/GroupAvatar';
import { useCursorList } from '@/features/friends/useCursorList';
import { useFriends } from '@/features/friends/FriendsContext';
import { fetchNotifications } from '@/shared/api/api';
import type { NotificationEntry } from '@/shared/api/api';
import { cn } from '@/shared/lib/utils';
import { describeNotification, formatRelativeTime } from './notificationText';

function NotificationIcon({ entry }: { entry: NotificationEntry }) {
  if (entry.kind === 'group_invitation' && entry.group) return <GroupAvatar title={entry.group.title} avatar={entry.group.avatar} size={36} />;
  const actor = entry.actor;
  return <Avatar id={actor?.id ?? entry.id} name={actor?.displayName ?? '?'} avatar={actor?.avatar ?? ''} avatarColor={actor?.avatarColor ?? 'blurple'} size={36} className="flex-none" />;
}

export function NotificationList({ onSelect }: { onSelect: (entry: NotificationEntry) => void }) {
  const { revision } = useFriends();
  const fetchPage = useCallback((cursor: string | null) => fetchNotifications(cursor), []);
  const list = useCursorList(fetchPage, String(revision));

  if (list.status === 'loading') return <p className="py-6 text-center text-label text-text-muted">Carregando…</p>;
  if (list.status === 'error') {
    return (
      <div className="flex flex-col items-center gap-2 py-6 text-center">
        <p className="text-label text-text-muted">Não foi possível carregar as notificações.</p>
        <Button type="button" variant="secondary" size="sm" onClick={list.retry}>Tentar de novo</Button>
      </div>
    );
  }
  if (list.items.length === 0) return <p className="py-6 text-center text-label text-text-muted">Nenhuma notificação por enquanto.</p>;

  return (
    <ul className="flex max-h-[min(24rem,60vh)] flex-col overflow-y-auto">
      {list.items.map((entry) => (
        <li key={entry.id}>
          <button
            type="button"
            onClick={() => onSelect(entry)}
            className={cn(
              'flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              !entry.read && 'bg-primary/[0.08]',
            )}
          >
            <NotificationIcon entry={entry} />
            <span className="min-w-0 flex-1">
              <span className={cn('block text-label text-text-primary', !entry.read && 'font-medium')}>{describeNotification(entry)}</span>
              <span className="block text-caption text-text-muted">{formatRelativeTime(entry.at)}</span>
            </span>
            {!entry.read && <span aria-label="Não lida" className="size-2 flex-none rounded-full bg-primary" />}
          </button>
        </li>
      ))}
      {list.hasMore && (
        <Button type="button" variant="ghost" size="sm" className="mt-1 self-center" disabled={list.loadingMore} onClick={list.loadMore}>
          {list.loadingMore ? 'Carregando…' : 'Carregar mais'}
        </Button>
      )}
    </ul>
  );
}

import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Bell } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/primitives/popover';
import { Button, buttonVariants } from '@/shared/ui/primitives/button';
import { clearNotifications, deleteNotification, markNotificationsRead } from '@/shared/api/api';
import type { NotificationEntry } from '@/shared/api/api';
import { cn } from '@/shared/lib/utils';
import { useFriends } from '@/features/friends/FriendsContext';
import { NotificationList } from './NotificationList';
import { formatUnread, notificationTarget } from './notificationText';
import { useUnreadNotifications } from './useUnreadNotifications';

export function NotificationBell({ collapsed = false, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const navigate = useNavigate();
  const { bump } = useFriends();
  const { unread, setUnread } = useUnreadNotifications();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(false);

  async function markAndSync(input: { ids: string[] } | { all: true }, optimisticUnread: number) {
    setError(false);
    setUnread(optimisticUnread);
    try {
      await markNotificationsRead(input);
    } catch {
      setError(true);
    } finally {
      // reconcile the count and the open list with what the server really has
      bump();
    }
  }

  async function removeFromList(request: () => Promise<unknown>, unreadAfter: number) {
    setError(false);
    setUnread(unreadAfter);
    try {
      await request();
    } catch {
      setError(true);
    } finally {
      bump();
    }
  }

  function dismiss(entry: NotificationEntry) {
    void removeFromList(() => deleteNotification(entry.id), entry.read ? unread : Math.max(0, unread - 1));
  }

  function select(entry: NotificationEntry) {
    if (!entry.read) void markAndSync({ ids: [entry.id] }, Math.max(0, unread - 1));
    setOpen(false);
    navigate(notificationTarget(entry));
    onNavigate?.();
  }

  const label = unread > 0 ? `Notificações, ${unread} não lida${unread === 1 ? '' : 's'}` : 'Notificações';

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={label}
        className={collapsed
          ? 'relative grid size-11 place-items-center rounded-xl text-text-muted transition-colors hover:bg-white/[0.06] hover:text-text-primary'
          : cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }), 'relative flex-none text-text-muted hover:text-text-primary')}
      >
        <Bell size={collapsed ? 18 : 16} />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 grid min-w-4.5 place-items-center rounded-full bg-primary px-1 text-[10px] font-bold leading-none text-primary-foreground">
            {formatUnread(unread)}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent side={collapsed ? 'right' : 'bottom'} align="start" className="w-[min(22rem,calc(100vw-1.5rem))] bg-bg-modal">
        <div className="flex flex-col gap-1 px-1">
          <h2 className="text-label font-semibold text-text-primary">Notificações</h2>
          <div className="-mx-2 flex items-center justify-between">
            <Button type="button" variant="ghost" size="sm" disabled={unread === 0} onClick={() => void markAndSync({ all: true }, 0)}>
              Marcar todas como lidas
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => void removeFromList(clearNotifications, 0)}>
              Limpar tudo
            </Button>
          </div>
        </div>
        {error && <p role="alert" className="rounded-md bg-red/12 px-2.5 py-1.5 text-label text-red-text">Não foi possível atualizar. Tente de novo.</p>}
        <NotificationList onSelect={select} onDismiss={dismiss} />
      </PopoverContent>
    </Popover>
  );
}

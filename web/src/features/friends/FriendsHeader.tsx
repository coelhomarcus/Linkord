import { Link, useNavigate } from 'react-router';
import { UserPlus } from 'lucide-react';
import { buttonVariants } from '@/shared/ui/primitives/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/primitives/select';
import { friendsView } from '@/shared/lib/routes';
import type { FriendsView } from '@/shared/lib/routes';
import { cn } from '@/shared/lib/utils';
import { CountBadge } from '@/shared/CountBadge';
import { useFriends } from './FriendsContext';

export type FriendsHeaderLayout = 'inline' | 'row' | 'select';

const MODES = [
  { view: 'all', label: 'Todos' },
  { view: 'online', label: 'Online' },
  { view: 'pending', label: 'Pendentes' },
  { view: 'invitations', label: 'Convites' },
] as const satisfies readonly { view: FriendsView; label: string }[];

/** How many actions wait on this account in each view — only pending/invitations have one. */
function useModeCounts(): Partial<Record<FriendsView, number>> {
  const { pendingFriendRequestCount, pendingInvitationCount } = useFriends();
  return { pending: pendingFriendRequestCount, invitations: pendingInvitationCount };
}

function ModeBadge({ count, label }: { count: number; label: string }) {
  return <CountBadge label={`${count} ${label}`}>{count > 99 ? '99+' : count}</CountBadge>;
}

const BADGE_LABEL: Partial<Record<FriendsView, string>> = { pending: 'solicitações aguardando resposta', invitations: 'convites aguardando resposta' };

/** The four list views, as links: the URL is the state, so Back/Forward and
 * shared links mean the same view. */
export function FriendsModeNav({ view, className }: { view: FriendsView; className?: string }) {
  const counts = useModeCounts();
  return (
    <nav aria-label="Visualização de Amigos" className={cn('flex items-center gap-1', className)}>
      {MODES.map((mode) => {
        const count = counts[mode.view] ?? 0;
        const current = mode.view === view;
        return (
          <Link
            key={mode.view}
            to={friendsView(mode.view)}
            aria-current={current ? 'page' : undefined}
            className={cn(
              'flex h-8 items-center gap-1.5 rounded-lg px-3 text-label font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
              current ? 'bg-white/[0.08] text-text-primary' : 'text-text-muted hover:bg-white/[0.05] hover:text-text-primary',
            )}
          >
            <span>{mode.label}</span>
            {count > 0 && <ModeBadge count={count} label={BADGE_LABEL[mode.view] ?? ''} />}
          </Link>
        );
      })}
    </nav>
  );
}

/** The same four views as one labelled select, for a narrow page area. */
export function FriendsModeSelect({ view }: { view: FriendsView }) {
  const counts = useModeCounts();
  const navigate = useNavigate();
  const current = MODES.find((mode) => mode.view === view) ?? MODES[0];
  const text = (mode: (typeof MODES)[number]) => (counts[mode.view] ? `${mode.label} (${counts[mode.view]})` : mode.label);
  return (
    <Select value={current.view} onValueChange={(next) => next && navigate(friendsView(next as FriendsView))}>
      <SelectTrigger aria-label="Visualização de Amigos" className="w-full">
        <SelectValue>{() => text(current)}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {MODES.map((mode) => <SelectItem key={mode.view} value={mode.view}>{text(mode)}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

export function AddFriendButton({ active, iconOnly }: { active: boolean; iconOnly?: boolean }) {
  return (
    <Link
      to={friendsView('add')}
      aria-current={active ? 'page' : undefined}
      aria-label="Adicionar amigo"
      className={cn(buttonVariants({ size: iconOnly ? 'icon-sm' : 'sm' }), active && 'ring-2 ring-primary/40')}
    >
      <UserPlus size={16} aria-hidden />
      {!iconOnly && <span>Adicionar amigo</span>}
    </Link>
  );
}

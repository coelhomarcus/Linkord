import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import { PanelLeftOpen, Settings, UsersRound } from 'lucide-react';
import { Avatar } from '@/shared/Avatar';
import { useAnimatedSidebar } from '@/shared/ui/motion/animated-sidebar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/primitives/tooltip';
import { ROUTES, isConversationsPath } from '@/shared/lib/routes';
import { cn } from '@/shared/lib/utils';
import { useRoom } from '@/state/RoomContext';
import { useFriends } from '@/features/friends/FriendsContext';
import { NotificationBell } from '@/features/notifications/NotificationBell';

const itemClass = 'relative grid size-11 place-items-center rounded-xl outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring';

function stateClass(active: boolean): string {
  return active ? 'bg-primary/20 text-text-primary' : 'text-text-muted hover:bg-white/[0.06] hover:text-text-primary';
}

/** A short bar on the edge: the selected destination isn't told by colour alone. */
function ActiveMarker() {
  return <span aria-hidden className="absolute -left-2.5 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-primary" />;
}

function RailBadge({ count }: { count: number }) {
  return (
    <span aria-hidden className="absolute -right-0.5 -top-0.5 grid min-w-4.5 place-items-center rounded-full bg-primary px-1 text-[10px] font-bold leading-none text-primary-foreground">
      {count > 99 ? '99+' : count}
    </span>
  );
}

function RailLink({ to, label, active, badge, onNavigate, children }: {
  to: string;
  label: string;
  active: boolean;
  badge?: number;
  onNavigate: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<Link to={to} onClick={onNavigate} aria-current={active ? 'page' : undefined} aria-label={label} className={cn(itemClass, stateClass(active))} />}
      >
        {active && <ActiveMarker />}
        {children}
        {!!badge && <RailBadge count={badge} />}
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

/** The global navigation: where you can go from anywhere. What belongs to one
 * conversation (search, creating a group, the list) stays in the conversations
 * sidebar beside it. On a narrow screen the same rail is drawn inside the
 * navigation sheet, so nothing here is reachable only on desktop. */
export function AppNavigationRail({ onOpenProfile, className }: { onOpenProfile: (userId: string) => void; className?: string }) {
  const { state } = useRoom();
  const { pendingIncomingCount } = useFriends();
  const { pathname } = useLocation();
  const { isMobile, open: listOpen, setOpenMobile, toggleSidebar } = useAnimatedSidebar();
  const afterNavigate = () => { if (isMobile) setOpenMobile(false); };
  const onSettings = pathname.startsWith(ROUTES.settings) || pathname.startsWith('/admin');
  const friendsLabel = pendingIncomingCount > 0 ? `Amigos, ${pendingIncomingCount} aguardando resposta` : 'Amigos';

  return (
    <nav aria-label="Navegação principal" className={cn('flex w-16 flex-none flex-col items-center gap-1.5 bg-bg-primary py-3', className)}>
      <RailLink to={ROUTES.conversations} label="Conversas" active={isConversationsPath(pathname)} onNavigate={afterNavigate}>
        <img src="/logo.svg" alt="" className="size-7" />
      </RailLink>
      <RailLink to={ROUTES.friends} label={friendsLabel} active={pathname === ROUTES.friends} badge={pendingIncomingCount} onNavigate={afterNavigate}>
        <UsersRound size={20} aria-hidden />
      </RailLink>
      <NotificationBell collapsed onNavigate={afterNavigate} />

      <div className="flex-1" />

      {/* hiding lives in the list's own header; once it is hidden this is the way back */}
      {!isMobile && !listOpen && (
        <Tooltip>
          <TooltipTrigger
            onClick={toggleSidebar}
            aria-label="Mostrar lista de conversas"
            aria-expanded={false}
            className={cn(itemClass, stateClass(false))}
          >
            <PanelLeftOpen size={20} aria-hidden />
          </TooltipTrigger>
          <TooltipContent side="right">Mostrar lista de conversas</TooltipContent>
        </Tooltip>
      )}
      <RailLink to={ROUTES.settings} label="Ajustes" active={onSettings} onNavigate={afterNavigate}>
        <Settings size={20} aria-hidden />
      </RailLink>
      <Tooltip>
        <TooltipTrigger
          onClick={() => { if (state.me.userId) onOpenProfile(state.me.userId); afterNavigate(); }}
          aria-label="Meu perfil"
          className={cn(itemClass, stateClass(false))}
        >
          <Avatar id={state.me.userId ?? state.me.id ?? 'me'} name={state.me.displayName} avatar={state.me.avatar} avatarColor={state.me.avatarColor} size={32} />
        </TooltipTrigger>
        <TooltipContent side="right">Meu perfil</TooltipContent>
      </Tooltip>
    </nav>
  );
}

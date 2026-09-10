import { useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { ChevronDown, FolderPlus, Hash, Headphones, HeadphoneOff, Mic, MicOff, PhoneOff, Plus, Settings } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/shared/lib/utils';
import { useRoom } from '../state/RoomContext';
import { useParticipantMedia } from '../features/sharing/useLiveKitTrack';
import { useMediaDevices } from '../features/settings/useMediaDevices';
import { Avatar } from '../shared/Avatar';
import { PromptDialog } from '../shared/PromptDialog';
import { ChannelTree, NewChannelDialog } from './ChannelTree';
import { loadSidebarWidth, saveSidebarWidth, SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH } from '../features/settings/useSidebarWidthPreference';
import type { Channel } from '../types/protocol';

export type AppView = 'chat' | 'call';

interface LeftSidebarProps {
  activeView: AppView;
  onViewChange: (view: AppView, voiceChannelId?: string) => void;
  inCall: boolean;
  onOpenSettings: () => void;
  onOpenProfile: (userId: string) => void;
  mobileVisible: boolean;
  onSelectChannelMobile: () => void;
}

export function LeftSidebar({ activeView, onViewChange, inCall, onOpenSettings, onOpenProfile, mobileVisible, onSelectChannelMobile }: LeftSidebarProps) {
  const { state, livekitRoom, toggleMicMuted, deafened, toggleDeafened, leaveVoiceChannel, joinVoiceChannel, openChannel, activeChannelId, categories, createCategory } = useRoom();
  const myMedia = useParticipantMedia(state.me.id ?? '');
  const mics = useMediaDevices(livekitRoom, 'audioinput');
  const isAdmin = state.me.role === 'admin';
  const [newCategoryOpen, setNewCategoryOpen] = useState(false);
  const [newChannelOpen, setNewChannelOpen] = useState(false);

  const [width, setWidth] = useState(loadSidebarWidth);
  const asideRef = useRef<HTMLElement>(null);
  const resizingRef = useRef(false);

  function handleResizePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    resizingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }

  function handleResizePointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!resizingRef.current || !asideRef.current) return;
    const left = asideRef.current.getBoundingClientRect().left;
    setWidth(Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, e.clientX - left)));
  }

  function handleResizePointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    if (!resizingRef.current) return;
    resizingRef.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    setWidth((w) => { saveSidebarWidth(w); return w; });
  }

  function handleSelectChannel(channel: Channel) {
    if (channel.type === 'voice') {
      joinVoiceChannel(channel.id);
      onViewChange('call', channel.id);
    } else {
      onViewChange('chat');
      openChannel(channel.id);
    }
    onSelectChannelMobile();
  }

  return (
    <aside
      ref={asideRef}
      style={{ '--sidebar-w': `${width}px` } as CSSProperties}
      className={cn('relative w-full flex-none flex-col border-r border-subtle bg-bg-sidebar md:flex md:w-(--sidebar-w)', mobileVisible ? 'flex' : 'hidden')}
    >
      <div className="flex flex-none select-none items-center gap-2 px-4 py-3.5">
        <img src="/logo.svg" alt="" className="h-8 w-8 flex-none" />
        <span className="min-w-0 flex-1 truncate text-title font-bold tracking-tight text-text-primary">Linkord</span>
        {isAdmin && (
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon-sm" aria-label="Criar categoria ou canal" className="flex-none text-text-muted hover:text-text-secondary md:hidden" />}>
              <Plus size={18} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setNewCategoryOpen(true)}>
                <FolderPlus size={14} />
                <span>Nova categoria</span>
              </DropdownMenuItem>
              {categories.length > 0 && (
                <DropdownMenuItem onClick={() => setNewChannelOpen(true)}>
                  <Hash size={14} />
                  <span>Novo canal</span>
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <div data-sidebar-channels className="min-h-0 flex-1 overflow-y-auto px-2">
        <div className="flex flex-col gap-0.5">
          <ChannelTree activeChannelId={activeView === 'chat' ? activeChannelId : null} onSelectChannel={handleSelectChannel} onOpenProfile={onOpenProfile} />
        </div>
      </div>

      <div className="mx-2 mb-2 flex flex-none items-center gap-2 rounded-xl border border-strong bg-bg-tertiary px-2 py-2">
        <Avatar id={state.me.id ?? 'me'} name={state.me.displayName} avatar={state.me.avatar} avatarColor={state.me.avatarColor} size={36} />

        <div className={cn('ml-auto flex items-center rounded-md', myMedia.micMuted && inCall && 'bg-red/12')}>
          <Tooltip>
            <TooltipTrigger
              onClick={toggleMicMuted}
              disabled={!inCall}
              aria-label={myMedia.micMuted ? 'Desmutar' : 'Mutar'}
              className={cn(
                'flex h-8 w-8 items-center justify-center rounded-md transition-colors disabled:opacity-40 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                myMedia.micMuted && inCall ? 'text-red' : 'text-text-secondary hover:bg-bg-hover'
              )}
            >
              {myMedia.micMuted ? <MicOff size={18} /> : <Mic size={18} />}
            </TooltipTrigger>
            <TooltipContent side="top">{myMedia.micMuted ? 'Desmutar' : 'Mutar'}</TooltipContent>
          </Tooltip>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  type="button"
                  aria-label="Escolher microfone"
                  className={cn(
                    'flex h-8 w-5 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                    myMedia.micMuted && inCall ? 'text-red' : 'text-text-secondary hover:bg-bg-hover'
                  )}
                />
              }
            >
              <ChevronDown size={15} />
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="end" className="w-56">
              {mics.permissionNeeded ? (
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Microfone</DropdownMenuLabel>
                  <DropdownMenuItem onClick={() => mics.requestPermission()}>
                    <span>Permitir acesso pra listar os microfones</span>
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              ) : mics.devices.length === 0 ? (
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Microfone</DropdownMenuLabel>
                  <DropdownMenuItem disabled>
                    <span>Nenhum microfone encontrado</span>
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              ) : (
                <DropdownMenuRadioGroup value={mics.activeDeviceId} onValueChange={(v) => v && mics.selectDevice(v)}>
                  <DropdownMenuLabel>Microfone</DropdownMenuLabel>
                  {mics.devices.map((d) => (
                    <DropdownMenuRadioItem key={d.deviceId} value={d.deviceId}>
                      <span className="truncate">{d.label || d.deviceId}</span>
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <Tooltip>
          <TooltipTrigger
            onClick={toggleDeafened}
            aria-label={deafened ? 'Voltar a ouvir' : 'Parar de ouvir'}
            className={cn(
              'flex h-8 w-8 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
              deafened ? 'bg-red/12 text-red' : 'text-text-secondary hover:bg-bg-hover'
            )}
          >
            {deafened ? <HeadphoneOff size={18} /> : <Headphones size={18} />}
          </TooltipTrigger>
          <TooltipContent side="top">{deafened ? 'Voltar a ouvir' : 'Parar de ouvir'}</TooltipContent>
        </Tooltip>

        {inCall && (
          <Tooltip>
            <TooltipTrigger
              onClick={leaveVoiceChannel}
              aria-label="Sair da chamada"
              className="flex h-8 w-8 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-red/12 hover:text-red focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <PhoneOff size={18} />
            </TooltipTrigger>
            <TooltipContent side="top">Sair da chamada</TooltipContent>
          </Tooltip>
        )}

        <Tooltip>
          <TooltipTrigger
            className={buttonVariants({ variant: 'ghost', size: 'icon-sm' })}
            onClick={onOpenSettings}
            aria-label="Ajustes"
          >
            <Settings size={18} />
          </TooltipTrigger>
          <TooltipContent side="top">Ajustes</TooltipContent>
        </Tooltip>
      </div>

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Redimensionar barra lateral"
        onPointerDown={handleResizePointerDown}
        onPointerMove={handleResizePointerMove}
        onPointerUp={handleResizePointerUp}
        className="absolute inset-y-0 -right-1.5 z-10 hidden w-3 cursor-col-resize touch-none px-1.5 md:block"
      >
        <div className="h-full w-px bg-transparent transition-colors hover:bg-blurple active:bg-blurple" />
      </div>

      <PromptDialog
        open={newCategoryOpen}
        onOpenChange={setNewCategoryOpen}
        title="Nova categoria"
        label="Nome da categoria"
        placeholder="Ex: Anúncios"
        confirmLabel="Criar"
        onConfirm={createCategory}
      />
      <NewChannelDialog open={newChannelOpen} onOpenChange={setNewChannelOpen} />
    </aside>
  );
}

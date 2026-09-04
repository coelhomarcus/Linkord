import { useState } from 'react';
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
import type { Channel } from '../types/protocol';

export type AppView = 'chat' | 'call';

interface LeftSidebarProps {
  activeView: AppView;
  onViewChange: (view: AppView) => void;
  inCall: boolean;
  onOpenSettings: () => void;
  /** Below md, this pane and the content pane show one at a time — true
   * shows this one. Ignored from md up, where both are always visible. */
  mobileVisible: boolean;
  /** Notifies the Shell to switch to the content pane on mobile once a
   * channel is picked — irrelevant from md up. */
  onSelectChannelMobile: () => void;
}

/** App's center, Discord-style: channels grouped by category (a voice
 * channel is just another channel in the tree, with connected people
 * indented under it — see ChannelTree), and a fixed user area at the
 * bottom. */
export function LeftSidebar({ activeView, onViewChange, inCall, onOpenSettings, mobileVisible, onSelectChannelMobile }: LeftSidebarProps) {
  const { state, livekitRoom, toggleMicMuted, deafened, toggleDeafened, leaveVoiceChannel, joinVoiceChannel, openChannel, activeChannelId, categories, createCategory } = useRoom();
  const myMedia = useParticipantMedia(state.me.id ?? '');
  const mics = useMediaDevices(livekitRoom, 'audioinput');
  const isAdmin = state.me.role === 'admin';
  const [newCategoryOpen, setNewCategoryOpen] = useState(false);
  const [newChannelOpen, setNewChannelOpen] = useState(false);

  // selecting a text channel also switches to the Chat screen if not
  // already there; selecting a voice channel actually joins it (connects
  // to that specific channel's Room, leaving another if already in one)
  // and switches to the call screen.
  function handleSelectChannel(channel: Channel) {
    if (channel.type === 'voice') {
      joinVoiceChannel(channel.id);
      onViewChange('call');
    } else {
      onViewChange('chat');
      openChannel(channel.id);
    }
    onSelectChannelMobile();
  }

  return (
    <aside className={cn('w-full flex-none flex-col border-r border-subtle bg-bg-sidebar md:flex md:w-60', mobileVisible ? 'flex' : 'hidden')}>
      <div className="flex flex-none select-none items-center gap-2 px-4 py-3.5">
        <img src="/logo.svg" alt="" className="h-8 w-8 flex-none" />
        <span className="min-w-0 flex-1 truncate text-title font-bold tracking-tight text-text-primary">Linkord</span>
        {/* right-click for this same menu isn't reliable on touch — this
            covers admins on mobile (desktop already has it via
            GlobalContextMenu's right-click on this panel). */}
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

      {/* data-sidebar-channels: marks the area where right-click opens the
          admin options (new category/channel) in GlobalContextMenu — only
          this area, not the footer (avatar/mic/settings) below. */}
      <div data-sidebar-channels className="min-h-0 flex-1 overflow-y-auto px-2">
        <div className="flex flex-col gap-0.5">
          <ChannelTree activeChannelId={activeView === 'chat' ? activeChannelId : null} onSelectChannel={handleSelectChannel} />
        </div>
      </div>

      <div className="mx-2 mb-2 flex flex-none items-center gap-2 rounded-xl border border-strong bg-bg-tertiary px-2 py-2">
        <Avatar id={state.me.id ?? 'me'} name={state.me.name} avatar={state.me.avatar} size={36} />

        {/* mic + arrow: the arrow switches MICROPHONE (the PC's actual
            input device); disabled outside a call since there's no mic to
            mute before joining (avoids publishing the mic without going
            through joining a voice channel first) — device switching
            itself still works outside a call. */}
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

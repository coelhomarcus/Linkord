import { ChevronDown, Headphones, HeadphoneOff, Mic, MicOff, PhoneOff, Settings } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { buttonVariants } from '@/components/ui/button';
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
import { ChannelTree } from './ChannelTree';
import type { Channel } from '../types/protocol';

export type AppView = 'chat' | 'call';

interface LeftSidebarProps {
  activeView: AppView;
  onViewChange: (view: AppView) => void;
  inCall: boolean;
  onOpenSettings: () => void;
}

/** Centro do app, estilo Discord: canais agrupados por categoria (a Chamada
 * e um canal de voz como qualquer outro na arvore, com quem esta conectado
 * indentado embaixo dela — ver ChannelTree), e area do usuario fixa no
 * rodape. */
export function LeftSidebar({ activeView, onViewChange, inCall, onOpenSettings }: LeftSidebarProps) {
  const { state, livekitRoom, toggleMicMuted, deafened, toggleDeafened, leaveVoiceChannel, joinVoiceChannel, openChannel, activeChannelId } = useRoom();
  const myMedia = useParticipantMedia(state.me.id ?? '');
  const mics = useMediaDevices(livekitRoom, 'audioinput');

  // selecionar um canal de texto tambem troca pra tela de Chat, caso ainda
  // nao esteja nela; selecionar um canal de voz entra nele de fato (conecta
  // a Room desse canal especifico, sai de outro se eu estiver em algum) e
  // troca pra tela de call.
  function handleSelectChannel(channel: Channel) {
    if (channel.type === 'voice') {
      joinVoiceChannel(channel.id);
      onViewChange('call');
    } else {
      onViewChange('chat');
      openChannel(channel.id);
    }
  }

  return (
    <aside className="flex w-60 flex-none flex-col border-r border-subtle bg-bg-sidebar">
      <div className="flex flex-none select-none items-center gap-2 px-4 py-3.5">
        <img src="/logo.svg" alt="" className="h-8 w-8 flex-none" />
        <span className="text-title font-bold tracking-tight text-text-primary">Linkord</span>
      </div>

      {/* data-sidebar-channels: marca a area onde o botao direito abre as
          opcoes de admin (nova categoria/canal) no GlobalContextMenu — so
          essa area, nao o rodape (avatar/mic/ajustes) logo abaixo. */}
      <div data-sidebar-channels className="min-h-0 flex-1 overflow-y-auto px-2">
        <div className="flex flex-col gap-0.5">
          {/* sem rotulo "Comunicação" aqui de proposito — as categorias que
              o proprio admin cria (ChannelTree, Chamada inclusa) ja rotulam
              esse grupo, um segundo label por cima delas seria peso morto. */}
          <ChannelTree activeChannelId={activeView === 'chat' ? activeChannelId : null} onSelectChannel={handleSelectChannel} />
        </div>
      </div>

      {/* rodape unico e persistente, estilo Discord: usuario + controles de
          chamada sempre no mesmo lugar (nao troca de bloco ao entrar/sair
          da call — so os botoes de mic/fone ficam inertes fora dela).
          Cartao flutuante (nao mais uma barra encostada com border-t): fundo
          e borda proprios, com respiro (mx/mb) mostrando o bg-bg-sidebar por
          tras — pedido explicito de estilo "flutuante" igual a referencia.
          rounded-xl (nao -lg): bate com a pilula do composer do chat, mesma
          familia de cartao flutuante — pedido explicito de harmonia entre
          os dois. */}
      <div className="mx-2 mb-2 flex flex-none items-center gap-2 rounded-xl border border-strong bg-bg-tertiary px-2 py-2">
        {/* so a foto — sem nome do lado, pra ocupar menos espaco horizontal
            (o nome ja aparece no topo do rodape de Ajustes e em toda
            mensagem que a pessoa manda; aqui repetir so apertava os
            controles ao lado, ver o "c.." truncado que isso causava). */}
        <Avatar id={state.me.id ?? 'me'} name={state.me.name} avatar={state.me.avatar} size={36} />

        {/* mic + seta: a seta agora troca de MICROFONE (dispositivo de
            entrada real do pc), nao mais esconde "sair da chamada" — esse
            ganhou botao proprio, sempre visivel, logo depois. Desabilitado
            fora da chamada, nao ha mic nenhum pra mutar antes de entrar
            (evita publicar o mic sem passar pelo clique em "Chamada"), mas
            a troca de dispositivo em si funciona mesmo fora dela. */}
        {/* ml-auto no primeiro controle: sem o nome (flex-1) empurrando os
            botoes pra ponta, esse grupo (mic+seta ate ajustes) fica colado
            no avatar por padrao — ml-auto aqui sozinho basta pra empurrar
            ELE e tudo que vem depois pro fim da linha, igual ficava antes. */}
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

        {/* sair da chamada: botao proprio e sempre visivel quando ha
            chamada pra sair — antes ficava escondido dentro do dropdown do
            mic, dificil de achar. */}
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
    </aside>
  );
}

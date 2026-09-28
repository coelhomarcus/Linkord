import { ArrowLeft, ImageIcon, Info, Phone, Search } from 'lucide-react';
import { PageHeader } from '@/shared/PageHeader';
import { useAnimatedSidebar } from '@/shared/ui/motion/animated-sidebar';
import { Button } from '@/shared/ui/primitives/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/primitives/tooltip';
import { Avatar } from '@/shared/Avatar';
import { useRoom } from '@/state/RoomContext';
import { conversationTitle, directUser, groupMembers } from './conversationUtils';
import { GroupAvatar } from './GroupAvatar';
import { ChatSurface } from '@/features/chat/ChatSurface';
import { useRelationship } from '@/features/friends/useRelationship';
import { CloseButton } from '@/shared/ui/primitives/close-button';

interface ConversationPanelProps {
  onOpenProfile: (userId: string) => void;
  onOpenCall: (conversationId: string) => void;
  onOpenSearch: () => void;
  onOpenDetails: () => void;
  onOpenMedia: () => void;
}

export function ConversationPanel({ onOpenProfile, onOpenCall, onOpenSearch, onOpenDetails, onOpenMedia }: ConversationPanelProps) {
  const { state, dispatch, conversations, activeConversationId, allUsers, onlineUserIds, activeCallConversationId } = useRoom();
  const { setOpenMobile } = useAnimatedSidebar();
  const conversation = conversations.find((item) => item.id === activeConversationId) ?? null;
  const title = conversationTitle(conversation, state.me.userId, allUsers);
  const other = directUser(conversation, state.me.userId, allUsers);
  const members = groupMembers(conversation, allUsers);
  const online = other ? onlineUserIds.has(other.id) : false;
  const subtitle = conversation?.type === 'group'
    ? `${members.length} membros`
    : other ? (online ? 'Online' : 'Offline') : '';
  // `state.participants` only ever holds OTHER people (the server excludes
  // yourself from it) — my own row in this list has to come from `state.me`
  // instead, gated on whether I'm actually the one in this call.
  const otherCallParticipants = [...state.participants.values()].filter((p) => p.callConversationId === conversation?.id);
  const callParticipants = conversation && activeCallConversationId === conversation.id
    ? [{ id: state.me.userId ?? 'me', displayName: state.me.displayName, avatar: state.me.avatar, avatarColor: state.me.avatarColor }, ...otherCallParticipants]
    : otherCallParticipants;
  const directPeerId = conversation?.type === 'direct' ? (conversation.memberIds.find((id) => id !== state.me.userId) ?? null) : null;
  const { state: relationship } = useRelationship(directPeerId);
  // Same stance as DirectComposerGate: only a confirmed answer disables the
  // button — while loading (or on a failed read) the server's own check decides.
  const callBlockedReason = conversation?.status === 'suspended'
    ? null
    : relationship.status === 'ready' && relationship.value.relation === 'blocked'
      ? 'Você não pode ligar enquanto essa pessoa estiver bloqueada.'
      : relationship.status === 'ready' && relationship.value.relation !== 'friends'
        ? 'Vocês precisam ser amigos para fazer chamadas.'
        : null;
  const callJoinError = state.callJoinError && state.callJoinError.conversationId === conversation?.id ? state.callJoinError.message : null;

  return (
    <main className="flex h-full min-w-0 flex-1 flex-col text-text-primary">
      {conversation ? (
        <>
          <header className="flex h-16 flex-none items-center gap-3 border-b border-white/10 bg-[rgb(12_12_14)]/90 px-4 backdrop-blur">
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Voltar" onClick={() => setOpenMobile(true)} className="-ml-1 md:hidden">
              <ArrowLeft size={18} />
            </Button>
            {conversation.type === 'direct' && other ? (
              <button
                type="button"
                onClick={() => onOpenProfile(other.id)}
                className="transition-opacity hover:opacity-80"
                aria-label="Ver perfil"
              >
                <Avatar id={other.id} name={other.displayName} avatar={other.avatar} avatarColor={other.avatarColor} size={40} />
              </button>
            ) : (
              <button
                type="button"
                onClick={onOpenDetails}
                className="transition-colors hover:border-white/20"
                aria-label="Detalhes do grupo"
              >
                <GroupAvatar title={title} avatar={conversation.avatar} size={40} />
              </button>
            )}
            <button
              type="button"
              onClick={conversation.type === 'group' ? onOpenDetails : (other ? () => onOpenProfile(other.id) : undefined)}
              className="min-w-0 flex-1 text-left"
            >
              <h2 className="truncate text-title font-semibold">{title}</h2>
              {subtitle && <p className="truncate text-caption text-text-muted">{subtitle}</p>}
            </button>
            {callParticipants.length > 0 && (
              <Tooltip>
                <TooltipTrigger render={<div className="flex flex-none items-center -space-x-2" />}>
                  {callParticipants.slice(0, 4).map((p) => (
                    <Avatar key={p.id} id={p.id} name={p.displayName} avatar={p.avatar} avatarColor={p.avatarColor} size={28} className="ring-2 ring-[rgb(12_12_14)]" />
                  ))}
                  {callParticipants.length > 4 && (
                    <span className="grid size-7 place-items-center rounded-full bg-bg-tertiary text-[11px] font-semibold text-text-secondary ring-2 ring-[rgb(12_12_14)]">
                      +{callParticipants.length - 4}
                    </span>
                  )}
                </TooltipTrigger>
                <TooltipContent side="bottom">Na chamada</TooltipContent>
              </Tooltip>
            )}
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Mídias e links" onClick={onOpenMedia} className="text-text-muted hover:text-text-primary">
              <ImageIcon size={16} />
            </Button>
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Buscar mensagens" onClick={onOpenSearch} className="text-text-muted hover:text-text-primary">
              <Search size={16} />
            </Button>
            {conversation.type === 'group' && (
              <Button type="button" variant="ghost" size="icon-sm" aria-label="Detalhes do grupo" onClick={onOpenDetails} className="text-text-muted hover:text-text-primary">
                <Info size={16} />
              </Button>
            )}
            {callBlockedReason ? (
              <Tooltip>
                {/* a disabled button gets no pointer events, so the tooltip hangs off a wrapper */}
                <TooltipTrigger render={<span tabIndex={0} className="inline-flex rounded-md focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50" />}>
                  <Button type="button" size="icon-sm" aria-label="Entrar na chamada" disabled className="bg-bg-tertiary text-text-muted">
                    <Phone size={16} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">{callBlockedReason}</TooltipContent>
              </Tooltip>
            ) : (
              <Button type="button" size="icon-sm" aria-label="Entrar na chamada" disabled={conversation.status === 'suspended'} onClick={() => onOpenCall(conversation.id)} className="bg-green text-bg-primary hover:bg-green/90">
                <Phone size={16} />
              </Button>
            )}
          </header>
          {callJoinError && (
            <div role="alert" className="mx-3 mt-3 flex items-start gap-2 rounded-md border border-red/40 bg-bg-floating px-3 py-2 text-label text-text-secondary shadow-popover md:mx-4">
              <Phone size={16} className="mt-0.5 flex-none text-red" />
              <span className="min-w-0 flex-1">{callJoinError}</span>
              <CloseButton size="xs" label="Dispensar aviso" onClick={() => dispatch({ type: 'SET_CALL_JOIN_ERROR', error: null })} />
            </div>
          )}
          {conversation.status === 'suspended' ? (
              <div role="status" className="grid flex-1 place-items-center px-6 text-center">
                <div>
                  <p className="text-title font-semibold text-text-primary">Grupo suspenso</p>
                  <p className="mt-1 max-w-sm text-label text-text-muted">A administração suspendeu este grupo. Enquanto durar, ninguém lê, escreve ou entra em chamada.</p>
                </div>
              </div>
            ) : (
              <ChatSurface conversationId={conversation.id} onOpenProfile={onOpenProfile} />
            )}
        </>
      ) : (
        <>
          {/* the header carries the button that reopens the drawer on a phone, where nothing else can */}
          <PageHeader title="Conversas" />
          <div className="grid flex-1 place-items-center px-6 text-center">
            <div>
              <p className="text-title font-semibold text-text-primary">Abra uma conversa</p>
              <p className="mt-1 text-label text-text-muted">Escolha uma pessoa ou grupo na sidebar.</p>
            </div>
          </div>
        </>
      )}
    </main>
  );
}

import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { messagePreviewText } from '@/features/chat/messagePreview';
import { PanelLeftClose, Pin, Plus, Search, Users, PhoneCall } from 'lucide-react';
import { AnimatedSidebar, useAnimatedSidebar } from '@/shared/ui/motion/animated-sidebar';
import { Button } from '@/shared/ui/primitives/button';
import { Avatar } from '@/shared/Avatar';
import { formatTime } from '@/shared/lib/formatChatTime';
import { formatTypingLabel } from '@/shared/lib/formatTypingLabel';
import { cn } from '@/shared/lib/utils';
import { useRoom } from '@/state/RoomContext';
import type { Conversation } from '@/shared/types/protocol';
import { ROUTES, friendsView, isConversationsPath } from '@/shared/lib/routes';
import { conversationTitle, directUser, groupMembers } from './conversationUtils';
import { GroupAvatar } from './GroupAvatar';
import { GroupCreateDialog } from './GroupCreateDialog';
import { TransitionNotice } from '@/features/onboarding/TransitionNotice';

interface ConversationSidebarProps {
  onOpenPalette: () => void;
  /** the global rail, drawn inside the sheet on a narrow screen (on desktop it sits beside the sidebar) */
  mobileRail: ReactNode;
}

function ConversationRow({ conversation, active, onClick }: {
  conversation: Conversation;
  active: boolean;
  onClick: () => void;
}) {
  const { state, allUsers, onlineUserIds, messagesByConversation, unreadByConversation, typingByConversation, activeCallConversationId } = useRoom();
  const title = conversationTitle(conversation, state.me.userId, allUsers);
  const other = directUser(conversation, state.me.userId, allUsers);
  const members = groupMembers(conversation, allUsers);
  const unread = unreadByConversation.get(conversation.id) ?? 0;
  const lastMessage = messagesByConversation.get(conversation.id)?.at(-1);
  const typingUserIds = typingByConversation.get(conversation.id);
  const typingLabel = typingUserIds?.size
    ? formatTypingLabel([...typingUserIds].map((id) => allUsers.get(id)?.displayName ?? '???'))
    : null;
  // `state.participants` never includes yourself (server excludes you from
  // it) — same "prepend me if it's my active call" pattern as
  // ConversationPanel.tsx's header avatar stack.
  const otherCallParticipants = [...state.participants.values()].filter((p) => p.callConversationId === conversation.id);
  const callParticipants = activeCallConversationId === conversation.id
    ? [{ id: state.me.userId ?? 'me', displayName: state.me.displayName, avatar: state.me.avatar, avatarColor: state.me.avatarColor }, ...otherCallParticipants]
    : otherCallParticipants;
  const hasActiveCall = callParticipants.length > 0;
  const subtitle = conversation.status === 'suspended'
    ? 'Suspenso pela administração'
    : lastMessage
    ? `${lastMessage.id === state.me.userId ? 'Você' : lastMessage.name}: ${messagePreviewText(lastMessage)}`
    : conversation.type === 'group'
      ? `${members.length} membros`
      : other?.username ? `@${other.username}` : 'Conversa direta';
  const time = (lastMessage?.ts ?? conversation.lastMessageAt) ? formatTime(lastMessage?.ts ?? conversation.lastMessageAt!) : '';
  const online = other ? onlineUserIds.has(other.id) : false;

  return (
    <div data-conversation-id={conversation.id} data-user-id={other?.id}>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors',
          active
            ? 'border-primary/35 bg-primary/12 text-text-primary shadow-[inset_0_1px_0_rgb(255_255_255_/_0.06)]'
            : 'border-transparent text-text-secondary hover:border-white/10 hover:bg-white/[0.045]'
        )}
      >
        {conversation.type === 'direct' && other ? (
          <div className="relative flex-none">
            <Avatar id={other.id} name={other.displayName} avatar={other.avatar} avatarColor={other.avatarColor} size={44} />
            <span className={cn('absolute -bottom-0.5 -right-0.5 size-3.5 rounded-full border-2 border-[rgb(14_14_16)]', online ? 'bg-green' : 'bg-text-muted')} />
          </div>
        ) : (
          <div className="relative flex-none">
            <GroupAvatar title={title} avatar={conversation.avatar} active={active} />
            <span className="absolute -bottom-0.5 -right-0.5 grid size-4 place-items-center rounded-full border-2 border-[rgb(14_14_16)] bg-bg-tertiary text-text-secondary">
              <Users size={9} />
            </span>
          </div>
        )}
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-label font-semibold">{title}</span>
            {hasActiveCall && (
              <span className="flex flex-none items-center gap-1">
                <PhoneCall size={13} className="flex-none text-green" />
                <span className="flex items-center -space-x-1.5">
                  {callParticipants.slice(0, 4).map((p) => (
                    <Avatar key={p.id} id={p.id} name={p.displayName} avatar={p.avatar} avatarColor={p.avatarColor} size={18} className="ring-2 ring-[rgb(14_14_16)]" />
                  ))}
                  {callParticipants.length > 4 && (
                    <span className="grid size-4.5 place-items-center rounded-full bg-bg-tertiary text-[9px] font-semibold text-text-secondary ring-2 ring-[rgb(14_14_16)]">
                      +{callParticipants.length - 4}
                    </span>
                  )}
                </span>
              </span>
            )}
          </span>
          <span className="mt-0.5 block truncate text-caption text-text-muted">{typingLabel ?? subtitle}</span>
        </span>
        <span className="flex flex-none flex-col items-end gap-1">
          <span className="flex items-center gap-1">
            {!!conversation.pinnedAt && <Pin size={11} className="fill-text-muted text-text-muted" />}
            {time && <span className="text-[11px] leading-none text-text-muted">{time}</span>}
          </span>
          {unread > 0 && (
            <span className="grid min-w-5 place-items-center rounded-full bg-primary px-1.5 py-0.5 text-[11px] font-bold leading-none text-primary-foreground">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </span>
      </button>
    </div>
  );
}

export function ConversationSidebar({ onOpenPalette, mobileRail }: ConversationSidebarProps) {
  const { state, conversations, activeConversationId, openConversation, allUsers, requestChatView } = useRoom();
  const { isMobile, isOverlay, setOpenMobile, toggleSidebar } = useAnimatedSidebar();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [query, setQuery] = useState('');
  const [groupOpen, setGroupOpen] = useState(false);
  const normalized = query.trim().toLowerCase();

  const filteredConversations = useMemo(() => (
    conversations.filter((conversation) => conversationTitle(conversation, state.me.userId, allUsers).toLowerCase().includes(normalized))
  ), [allUsers, conversations, normalized, state.me.userId]);

  function selectConversation(conversationId: string) {
    openConversation(conversationId);
    // explicit, not left to the URL sync: re-opening the conversation that is
    // ALREADY active (from the friends page, say) changes no state, so nothing
    // else would navigate. Done before requestChatView so that call sees a
    // conversations path and doesn't push a second history entry.
    navigate(ROUTES.conversation(conversationId));
    requestChatView();
    if (isOverlay) setOpenMobile(false);
  }

  const onConversations = isConversationsPath(pathname);

  return (
    <>
      <AnimatedSidebar
        variant="sidebar"
        collapsible="offcanvas"
        ariaLabel="Conversas"
        className="text-text-primary"
        panelClassName="border-r-0 bg-bg-primary"
      >
        <div className="flex h-full min-h-0">
          {/* on a phone the rail lives in the drawer; from 768px it stays on screen beside it */}
          {isMobile && mobileRail}
          <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
            <div className="flex flex-none items-center gap-2 px-4 py-4">
              <h1 className="min-w-0 flex-1 truncate text-title font-semibold">Conversas</h1>
              <Button type="button" size="icon-sm" aria-label="Criar grupo" onClick={() => setGroupOpen(true)} className="flex-none">
                <Plus size={16} />
              </Button>
              {!isOverlay && (
                <Button type="button" variant="ghost" size="icon-sm" aria-label="Ocultar lista de conversas" onClick={toggleSidebar} className="flex-none text-text-muted hover:text-text-primary">
                  <PanelLeftClose size={16} />
                </Button>
              )}
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-3 px-3 pb-3">
              <div className="flex flex-none items-center gap-2 rounded-xl border border-white/10 bg-white/[0.045] px-3">
                <Search size={15} className="text-text-muted" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Buscar conversas"
                  className="h-10 min-w-0 flex-1 bg-transparent text-label outline-none placeholder:text-text-muted"
                />
                <button
                  type="button"
                  onClick={onOpenPalette}
                  aria-label="Abrir busca rápida (Ctrl+K)"
                  className="flex-none rounded border border-white/10 bg-black/20 px-1.5 py-0.5 text-[10px] font-medium text-text-muted transition-colors hover:text-text-secondary"
                >
                  ⌘K
                </button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto">
                <TransitionNotice onOpenFriends={() => { navigate(friendsView('all')); if (isOverlay) setOpenMobile(false); }} />
                <div className="flex flex-col gap-1">
                  {filteredConversations.length === 0 ? (
                    <p className="px-3 py-8 text-center text-label text-text-muted">Nenhuma conversa.</p>
                  ) : filteredConversations.map((conversation) => (
                    <ConversationRow
                      key={conversation.id}
                      conversation={conversation}
                      active={onConversations && conversation.id === activeConversationId}
                      onClick={() => selectConversation(conversation.id)}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </AnimatedSidebar>
      <GroupCreateDialog
        open={groupOpen}
        onOpenChange={setGroupOpen}
        onCreated={() => { if (isOverlay) setOpenMobile(false); }}
      />
    </>
  );
}

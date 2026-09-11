import { useMemo, useState } from 'react';
import { MessageCircle, MoreHorizontal, PanelLeftClose, Plus, Search, Settings, Users, UsersRound, PhoneCall, X } from 'lucide-react';
import { AnimatedSidebar, useAnimatedSidebar } from '@/components/motion/animated-sidebar';
import { Button, buttonVariants } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/motion/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Avatar } from '@/shared/Avatar';
import { formatTime } from '@/shared/lib/formatChatTime';
import { cn } from '@/shared/lib/utils';
import { useRoom } from '@/state/RoomContext';
import type { Conversation, PublicUser } from '@/types/protocol';
import { conversationTitle, directUser, groupMembers } from './conversationUtils';
import { GroupAvatar } from './GroupAvatar';
import { GroupCreateDialog } from './GroupCreateDialog';

interface ConversationSidebarProps {
  onOpenSettings: () => void;
  onOpenProfile: (userId: string) => void;
}

function ConversationRow({ conversation, active, onClick }: {
  conversation: Conversation;
  active: boolean;
  onClick: () => void;
}) {
  const { state, allUsers, onlineUserIds, messagesByConversation, unreadByConversation, closeConversation, activeCallConversationId } = useRoom();
  const title = conversationTitle(conversation, state.me.userId, allUsers);
  const other = directUser(conversation, state.me.userId, allUsers);
  const members = groupMembers(conversation, allUsers);
  const unread = unreadByConversation.get(conversation.id) ?? 0;
  const lastMessage = messagesByConversation.get(conversation.id)?.at(-1);
  // `state.participants` never includes yourself (server excludes you from
  // it) — same "prepend me if it's my active call" pattern as
  // ConversationPanel.tsx's header avatar stack.
  const otherCallParticipants = [...state.participants.values()].filter((p) => p.callConversationId === conversation.id);
  const callParticipants = activeCallConversationId === conversation.id
    ? [{ id: state.me.userId ?? 'me', displayName: state.me.displayName, avatar: state.me.avatar, avatarColor: state.me.avatarColor }, ...otherCallParticipants]
    : otherCallParticipants;
  const hasActiveCall = callParticipants.length > 0;
  const subtitle = lastMessage
    ? `${lastMessage.id === state.me.userId ? 'Voce' : lastMessage.name}: ${lastMessage.text || 'Anexo'}`
    : conversation.type === 'group'
      ? `${members.length} membros`
      : other?.username ? `@${other.username}` : 'Conversa direta';
  const time = (lastMessage?.ts ?? conversation.lastMessageAt) ? formatTime(lastMessage?.ts ?? conversation.lastMessageAt!) : '';
  const online = other ? onlineUserIds.has(other.id) : false;

  return (
    <div className="group relative">
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
          <span className="mt-0.5 block truncate text-caption text-text-muted">{subtitle}</span>
        </span>
        <span className="flex flex-none flex-col items-end gap-1">
          {time && <span className="text-[11px] leading-none text-text-muted">{time}</span>}
          {unread > 0 && (
            <span className="grid min-w-5 place-items-center rounded-full bg-primary px-1.5 py-0.5 text-[11px] font-bold leading-none text-primary-foreground">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </span>
      </button>
      {conversation.type === 'direct' && (
        <div className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 pointer-events-none transition-opacity group-hover:opacity-100 group-hover:pointer-events-auto">
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon-xs" aria-label="Mais opcoes da conversa" className="bg-[rgb(20_20_23)]" />}>
              <MoreHorizontal size={14} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => closeConversation(conversation.id)}>
                <X size={14} />
                Fechar conversa
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  );
}

function UserRow({ user, onClick, onOpenProfile }: { user: PublicUser; onClick: () => void; onOpenProfile: (userId: string) => void }) {
  const { onlineUserIds } = useRoom();
  const online = onlineUserIds.has(user.id);
  return (
    <div className="group flex items-center gap-2 rounded-xl border border-transparent px-2 py-2 hover:border-white/10 hover:bg-white/[0.045]">
      <button type="button" onClick={onClick} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <div className="relative flex-none">
          <Avatar id={user.id} name={user.displayName} avatar={user.avatar} avatarColor={user.avatarColor} size={40} />
          <span className={cn('absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-[rgb(14_14_16)]', online ? 'bg-green' : 'bg-text-muted')} />
        </div>
        <span className="min-w-0">
          <span className="block truncate text-label font-medium text-text-secondary">{user.displayName}</span>
          <span className="block truncate text-caption text-text-muted">@{user.username}</span>
        </span>
      </button>
      <Button type="button" variant="ghost" size="icon-xs" aria-label={`Abrir perfil de ${user.displayName}`} onClick={() => onOpenProfile(user.id)} className="opacity-0 transition-opacity group-hover:opacity-100">
        <UsersRound size={13} />
      </Button>
    </div>
  );
}

function CollapsedConversationButton({ conversation, active, onClick }: {
  conversation: Conversation;
  active: boolean;
  onClick: () => void;
}) {
  const { state, allUsers, unreadByConversation } = useRoom();
  const title = conversationTitle(conversation, state.me.userId, allUsers);
  const other = directUser(conversation, state.me.userId, allUsers);
  const unread = unreadByConversation.get(conversation.id) ?? 0;

  return (
    <Tooltip>
      <TooltipTrigger
        onClick={onClick}
        aria-label={title}
        className={cn(
          'relative grid size-11 flex-none place-items-center rounded-full transition-colors',
          active ? 'bg-primary/20 ring-1 ring-primary/50' : 'hover:bg-white/[0.06]'
        )}
      >
        {conversation.type === 'direct' && other ? (
          <Avatar id={other.id} name={other.displayName} avatar={other.avatar} avatarColor={other.avatarColor} size={40} />
        ) : (
          <GroupAvatar title={title} avatar={conversation.avatar} active={active} />
        )}
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 grid min-w-4.5 place-items-center rounded-full bg-primary px-1 text-[10px] font-bold leading-none text-primary-foreground">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </TooltipTrigger>
      <TooltipContent side="right">{title}</TooltipContent>
    </Tooltip>
  );
}

export function ConversationSidebar({ onOpenSettings, onOpenProfile }: ConversationSidebarProps) {
  const { state, conversations, activeConversationId, openConversation, openDirect, allUsers, requestChatView } = useRoom();
  const { isMobile, open: sidebarOpen, setOpenMobile, toggleSidebar } = useAnimatedSidebar();
  const collapsed = !isMobile && !sidebarOpen;
  const [tab, setTab] = useState('conversations');
  const [query, setQuery] = useState('');
  const [groupOpen, setGroupOpen] = useState(false);
  const normalized = query.trim().toLowerCase();
  const isAdmin = state.me.role === 'admin';

  const filteredConversations = useMemo(() => (
    conversations.filter((conversation) => conversationTitle(conversation, state.me.userId, allUsers).toLowerCase().includes(normalized))
  ), [allUsers, conversations, normalized, state.me.userId]);

  const filteredUsers = useMemo(() => (
    [...allUsers.values()]
      .filter((user) => user.id !== state.me.userId)
      .filter((user) => !normalized || user.displayName.toLowerCase().includes(normalized) || user.username.toLowerCase().includes(normalized))
      .sort((a, b) => a.displayName.localeCompare(b.displayName) || a.username.localeCompare(b.username))
  ), [allUsers, normalized, state.me.userId]);

  function selectConversation(conversationId: string) {
    openConversation(conversationId);
    requestChatView();
    if (isMobile) setOpenMobile(false);
  }

  function selectUser(userId: string) {
    openDirect(userId);
    requestChatView();
    if (isMobile) setOpenMobile(false);
  }

  return (
    <>
      <AnimatedSidebar
        variant="sidebar"
        collapsible="icon"
        ariaLabel="Conversas"
        className="text-text-primary"
        panelClassName="border-r-0 bg-bg-primary"
      >
        {collapsed ? (
          <div className="flex h-full flex-col items-center gap-1.5 py-3">
            <Tooltip>
              <TooltipTrigger
                onClick={toggleSidebar}
                aria-label="Expandir sidebar"
                className="grid size-11 flex-none place-items-center rounded-xl text-text-muted transition-colors hover:bg-white/[0.06] hover:text-text-primary"
              >
                <img src="/logo.svg" alt="" className="size-7" />
              </TooltipTrigger>
              <TooltipContent side="right">Expandir sidebar</TooltipContent>
            </Tooltip>

            <div className="my-1 h-px w-8 flex-none bg-white/10" />

            <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-1">
              {filteredConversations.map((conversation) => (
                <CollapsedConversationButton
                  key={conversation.id}
                  conversation={conversation}
                  active={conversation.id === activeConversationId}
                  onClick={() => selectConversation(conversation.id)}
                />
              ))}
            </div>

            <div className="flex flex-none flex-col gap-1.5">
              {isAdmin && (
                <Tooltip>
                  <TooltipTrigger
                    onClick={() => setGroupOpen(true)}
                    aria-label="Criar grupo"
                    className={cn(buttonVariants({ size: 'icon-sm' }), 'size-11 rounded-xl')}
                  >
                    <Plus size={18} />
                  </TooltipTrigger>
                  <TooltipContent side="right">Criar grupo</TooltipContent>
                </Tooltip>
              )}
              <Tooltip>
                <TooltipTrigger
                  onClick={onOpenSettings}
                  aria-label="Ajustes"
                  className="grid size-11 place-items-center rounded-xl text-text-muted transition-colors hover:bg-white/[0.06] hover:text-text-primary"
                >
                  <Settings size={18} />
                </TooltipTrigger>
                <TooltipContent side="right">Ajustes</TooltipContent>
              </Tooltip>
            </div>
          </div>
        ) : (
          <div className="flex h-full min-h-0 flex-col">
            <div className="flex flex-none items-center gap-3 px-4 py-4">
              <img src="/logo.svg" alt="" className="size-8 flex-none" />
              <div className="min-w-0 flex-1">
                <h1 className="truncate text-title font-semibold">Linkord</h1>
                <p className="truncate text-caption text-text-muted">{state.me.displayName}</p>
              </div>
              {isAdmin && (
                <Button type="button" size="icon-sm" aria-label="Criar grupo" onClick={() => setGroupOpen(true)} className="flex-none">
                  <Plus size={16} />
                </Button>
              )}
              <Button type="button" variant="ghost" size="icon-sm" aria-label="Ajustes" onClick={onOpenSettings} className="flex-none text-text-muted hover:text-text-primary">
                <Settings size={16} />
              </Button>
              {!isMobile && (
                <Button type="button" variant="ghost" size="icon-sm" aria-label="Recolher sidebar" onClick={toggleSidebar} className="flex-none text-text-muted hover:text-text-primary">
                  <PanelLeftClose size={16} />
                </Button>
              )}
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-3 px-3 py-3">
              <div className="flex flex-none items-center gap-2 rounded-xl border border-white/10 bg-white/[0.045] px-3">
                <Search size={15} className="text-text-muted" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={tab === 'people' ? 'Buscar pessoas' : 'Buscar conversas'}
                  className="h-10 min-w-0 flex-1 bg-transparent text-label outline-none placeholder:text-text-muted"
                />
              </div>
              <Tabs value={tab} onValueChange={setTab} variant="segment" className="flex min-h-0 flex-1 flex-col">
                <TabsList className="flex-none grid w-full grid-cols-2 rounded-xl border border-white/10 bg-black/25 p-1">
                  <TabsTrigger value="conversations" className="w-full gap-1.5 rounded-lg">
                    <MessageCircle size={14} />
                    Conversas
                  </TabsTrigger>
                  <TabsTrigger value="people" className="w-full gap-1.5 rounded-lg">
                    <UsersRound size={14} />
                    Pessoas
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="conversations" className="mt-3 min-h-0 flex-1 overflow-y-auto">
                  <div className="flex flex-col gap-1">
                    {filteredConversations.length === 0 ? (
                      <p className="px-3 py-8 text-center text-label text-text-muted">Nenhuma conversa.</p>
                    ) : filteredConversations.map((conversation) => (
                      <ConversationRow
                        key={conversation.id}
                        conversation={conversation}
                        active={conversation.id === activeConversationId}
                        onClick={() => selectConversation(conversation.id)}
                      />
                    ))}
                  </div>
                </TabsContent>

                <TabsContent value="people" className="mt-3 min-h-0 flex-1 overflow-y-auto">
                  <div className="flex flex-col gap-1">
                    {filteredUsers.length === 0 ? (
                      <p className="px-3 py-8 text-center text-label text-text-muted">Nenhuma pessoa.</p>
                    ) : filteredUsers.map((user) => (
                      <UserRow key={user.id} user={user} onClick={() => selectUser(user.id)} onOpenProfile={onOpenProfile} />
                    ))}
                  </div>
                </TabsContent>
              </Tabs>
            </div>
          </div>
        )}
      </AnimatedSidebar>
      <GroupCreateDialog
        open={groupOpen}
        onOpenChange={setGroupOpen}
        onCreated={() => { setTab('conversations'); if (isMobile) setOpenMobile(false); }}
      />
    </>
  );
}

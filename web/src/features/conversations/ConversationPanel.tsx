import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { PageHeader } from '@/shared/PageHeader';
import type { DragEvent } from 'react';
import { ArrowLeft, ImageIcon, Info, Phone, Search, Upload } from 'lucide-react';
import { useAnimatedSidebar } from '@/shared/ui/motion/animated-sidebar';
import { Button } from '@/shared/ui/primitives/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/primitives/tooltip';
import { Avatar } from '@/shared/Avatar';
import { ChatSurfaceWidthProvider, useMeasuredWidth } from '@/shared/lib/chatSurfaceWidth';
import { formatDateHeading } from '@/shared/lib/formatChatTime';
import { formatTypingLabel } from '@/shared/lib/formatTypingLabel';
import { buildMentionLookup } from '@/shared/lib/mentions';
import { useRoom } from '@/state/RoomContext';
import type { ChatMessage } from '@/shared/types/protocol';
import { conversationTitle, directUser, groupMembers } from './conversationUtils';
import { GroupAvatar } from './GroupAvatar';
import { MessageRow } from '@/features/chat/MessageRow';
import { MessageComposer } from '@/features/chat/MessageComposer';
import { DirectComposerGate } from '@/features/friends/DirectComposerGate';
import type { MessageComposerHandle } from '@/features/chat/MessageComposer';

const GROUP_GAP_MS = 5 * 60 * 1000;
const EMPTY_MESSAGES: ChatMessage[] = [];

type RenderItem =
  | { type: 'date'; key: string; label: string }
  | { type: 'message'; key: string; message: ChatMessage; showHeader: boolean };

function buildRenderItems(messages: ChatMessage[]): RenderItem[] {
  const items: RenderItem[] = [];
  let lastMsg: ChatMessage | null = null;
  let lastDateKey = '';
  for (const message of messages) {
    const dateKey = new Date(message.ts).toDateString();
    if (dateKey !== lastDateKey) {
      items.push({ type: 'date', key: `date-${dateKey}`, label: formatDateHeading(message.ts) });
      lastDateKey = dateKey;
      lastMsg = null;
    }
    const showHeader = !lastMsg || lastMsg.id !== message.id || message.ts - lastMsg.ts > GROUP_GAP_MS;
    items.push({ type: 'message', key: String(message.msgId), message, showHeader });
    lastMsg = message;
  }
  return items;
}

export function MessageList({ conversationId, onReply, onOpenProfile, bottomPadding }: {
  conversationId: string;
  onReply: (message: ChatMessage) => void;
  onOpenProfile: (userId: string) => void;
  bottomPadding: number;
}) {
  const {
    messagesByConversation,
    allUsers,
    hasMoreByConversation,
    loadingOlderByConversation,
    loadOlderMessages,
    hasMoreAfterByConversation,
    pendingJumpTarget,
    clearPendingJumpTarget,
    openConversation,
  } = useRoom();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);
  // Set right before WE assign scrollTop ourselves (snapToBottom below),
  // cleared next frame. Guards against a real race: an image/video/embed
  // finishing layout fires the ResizeObserver below, which snaps scrollTop
  // to the new (larger) scrollHeight — but that assignment dispatches an
  // async native 'scroll' event. If a SECOND resize lands before that event
  // fires, the event's handler reads a scrollTop that's already stale
  // relative to the newest scrollHeight, measures a gap > 80, and wrongly
  // decides the user scrolled away — after which no future resize re-snaps,
  // since the ResizeObserver callback itself checks stickToBottomRef first.
  // That's "it never quite reaches the bottom" when several media items
  // resize in a burst (the exact case a media-heavy conversation hits on
  // open) — this flag tells handleScroll to skip recomputing stickiness for
  // 'scroll' events WE caused, so only a genuine user scroll can clear it.
  const programmaticScrollRef = useRef(false);
  const pendingPrependRef = useRef(false);
  const prevScrollHeightRef = useRef(0);
  const wasLoadingOlderRef = useRef(false);
  const [highlightedMsgId, setHighlightedMsgId] = useState<number | null>(null);
  const highlightTimeoutRef = useRef<number | null>(null);
  const mentionLookup = useMemo(() => buildMentionLookup(allUsers), [allUsers]);
  const messages = messagesByConversation.get(conversationId) ?? EMPTY_MESSAGES;
  const hasMoreHistory = hasMoreByConversation.get(conversationId) !== false;
  const isLoadingOlder = loadingOlderByConversation.has(conversationId);
  const items = useMemo(() => buildRenderItems(messages), [messages]);

  useLayoutEffect(() => {
    stickToBottomRef.current = true;
    pendingPrependRef.current = false;
    wasLoadingOlderRef.current = false;
  }, [conversationId]);

  // `el.scrollTop = el.scrollHeight` dispatches an async native 'scroll'
  // event — mark it as ours so handleScroll (below) doesn't treat it as a
  // real user scroll and misjudge stickiness against a stale read while
  // more resizes are still landing (see programmaticScrollRef above).
  function snapToBottom(el: HTMLDivElement) {
    programmaticScrollRef.current = true;
    el.scrollTop = el.scrollHeight;
    requestAnimationFrame(() => { programmaticScrollRef.current = false; });
  }

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottomRef.current) snapToBottom(el);
    // bottomPadding (the floating composer's measured height, reserved as
    // scroll-area padding — see MessageListBridge) starts at a guess and
    // jumps to the real value a tick after mount, and again whenever the
    // composer grows/shrinks (e.g. attachments added). That changes this
    // element's own scrollHeight without resizing contentRef below, so the
    // ResizeObserver in the next effect never sees it — this dependency is
    // what re-snaps to the true bottom when that happens.
  }, [messages, bottomPadding]);

  useEffect(() => {
    const scrollEl = scrollRef.current;
    const contentEl = contentRef.current;
    if (!scrollEl || !contentEl) return;
    const scrollNode: HTMLDivElement = scrollEl;
    const contentNode: HTMLDivElement = contentEl;
    function handleScroll() {
      if (programmaticScrollRef.current) return;
      stickToBottomRef.current = scrollNode.scrollHeight - scrollNode.scrollTop - scrollNode.clientHeight < 80;
      if (scrollNode.scrollTop <= 100 && !pendingPrependRef.current && !isLoadingOlder && hasMoreHistory) {
        pendingPrependRef.current = true;
        prevScrollHeightRef.current = scrollNode.scrollHeight;
        loadOlderMessages(conversationId);
      }
    }
    const observer = new ResizeObserver(() => {
      if (stickToBottomRef.current) snapToBottom(scrollNode);
    });
    observer.observe(contentNode);
    scrollNode.addEventListener('scroll', handleScroll);
    return () => {
      observer.disconnect();
      scrollNode.removeEventListener('scroll', handleScroll);
    };
  }, [conversationId, hasMoreHistory, isLoadingOlder, loadOlderMessages]);

  useLayoutEffect(() => {
    if (wasLoadingOlderRef.current && !isLoadingOlder) {
      const el = scrollRef.current;
      if (el && pendingPrependRef.current) {
        const delta = el.scrollHeight - prevScrollHeightRef.current;
        if (delta > 0) el.scrollTop = delta;
      }
      pendingPrependRef.current = false;
    }
    wasLoadingOlderRef.current = isLoadingOlder;
  }, [isLoadingOlder, messages]);

  function jumpToMessage(msgId: number, behavior: ScrollBehavior = 'smooth') {
    const el = document.getElementById(`chat-msg-${msgId}`);
    if (!el) return;
    el.scrollIntoView({ behavior, block: 'center' });
    if (highlightTimeoutRef.current != null) window.clearTimeout(highlightTimeoutRef.current);
    setHighlightedMsgId(msgId);
    highlightTimeoutRef.current = window.setTimeout(() => setHighlightedMsgId(null), 1500);
  }

  useLayoutEffect(() => {
    if (!pendingJumpTarget || pendingJumpTarget.conversationId !== conversationId) return;
    if (!messages.some((message) => message.msgId === pendingJumpTarget.msgId)) return;
    stickToBottomRef.current = false;
    jumpToMessage(pendingJumpTarget.msgId, 'auto');
    clearPendingJumpTarget();
  }, [pendingJumpTarget, messages, conversationId, clearPendingJumpTarget]);

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={scrollRef} className="h-full overflow-y-auto px-2 pt-3" style={{ paddingBottom: bottomPadding }}>
        <div ref={contentRef} className="mx-auto flex w-full max-w-5xl flex-col">
          {isLoadingOlder && <p className="my-3 text-center text-label text-text-muted">Carregando mensagens anteriores...</p>}
          {messages.length === 0 && (
            <div className="flex min-h-[45vh] items-center justify-center px-6 text-center text-label text-text-muted">
              Nenhuma mensagem ainda.
            </div>
          )}
          {items.map((item) => item.type === 'date' ? (
            <div key={item.key} className="my-4 flex select-none items-center justify-center px-4">
              <span className="flex-none text-caption font-medium text-text-muted opacity-60">{item.label}</span>
            </div>
          ) : (
            <MessageRow
              key={item.key}
              message={item.message}
              showHeader={item.showHeader}
              highlighted={highlightedMsgId === item.message.msgId}
              allUsers={allUsers}
              mentionLookup={mentionLookup}
              onReply={() => onReply(item.message)}
              onOpenProfile={onOpenProfile}
              onJumpTo={jumpToMessage}
            />
          ))}
        </div>
      </div>
      {hasMoreAfterByConversation.get(conversationId) === true && (
        <button
          type="button"
          onClick={() => {
            stickToBottomRef.current = true;
            openConversation(conversationId);
          }}
          style={{ bottom: bottomPadding + 16 }}
          className="absolute left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-1.5 text-label font-medium text-primary-foreground shadow-popover"
        >
          Voltar para o mais recente
        </button>
      )}
    </div>
  );
}

interface ConversationPanelProps {
  onOpenProfile: (userId: string) => void;
  onOpenCall: (conversationId: string) => void;
  onOpenSearch: () => void;
  onOpenDetails: () => void;
  onOpenMedia: () => void;
}

export function ConversationPanel({ onOpenProfile, onOpenCall, onOpenSearch, onOpenDetails, onOpenMedia }: ConversationPanelProps) {
  const { state, conversations, activeConversationId, allUsers, onlineUserIds, typingByConversation, activeCallConversationId } = useRoom();
  const { setOpenMobile } = useAnimatedSidebar();
  const conversation = conversations.find((item) => item.id === activeConversationId) ?? null;
  const title = conversationTitle(conversation, state.me.userId, allUsers);
  const other = directUser(conversation, state.me.userId, allUsers);
  const members = groupMembers(conversation, allUsers);
  const online = other ? onlineUserIds.has(other.id) : false;
  const subtitle = conversation?.type === 'group'
    ? `${members.length} membros`
    : other ? (online ? 'Online' : 'Offline') : '';
  const typingUserIds = activeConversationId ? typingByConversation.get(activeConversationId) : undefined;
  const typingLabel = typingUserIds?.size
    ? formatTypingLabel([...typingUserIds].map((id) => allUsers.get(id)?.displayName ?? '???'))
    : null;
  // `state.participants` only ever holds OTHER people (the server excludes
  // yourself from it) — my own row in this list has to come from `state.me`
  // instead, gated on whether I'm actually the one in this call.
  const otherCallParticipants = [...state.participants.values()].filter((p) => p.callConversationId === conversation?.id);
  const callParticipants = conversation && activeCallConversationId === conversation.id
    ? [{ id: state.me.userId ?? 'me', displayName: state.me.displayName, avatar: state.me.avatar, avatarColor: state.me.avatarColor }, ...otherCallParticipants]
    : otherCallParticipants;
  const mainRef = useRef<HTMLElement | null>(null);
  const surfaceWidth = useMeasuredWidth(mainRef);

  return (
    <main ref={mainRef} className="flex h-full min-w-0 flex-1 flex-col text-text-primary">
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
              {(typingLabel ?? subtitle) && <p className="truncate text-caption text-text-muted">{typingLabel ?? subtitle}</p>}
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
            <Button type="button" size="icon-sm" aria-label="Entrar na chamada" disabled={conversation.status === 'suspended'} onClick={() => onOpenCall(conversation.id)} className="bg-green text-bg-primary hover:bg-green/90">
              <Phone size={16} />
            </Button>
          </header>
          <ChatSurfaceWidthProvider width={surfaceWidth}>
            {conversation.status === 'suspended' ? (
              <div role="status" className="grid flex-1 place-items-center px-6 text-center">
                <div>
                  <p className="text-title font-semibold text-text-primary">Grupo suspenso</p>
                  <p className="mt-1 max-w-sm text-label text-text-muted">A administração suspendeu este grupo. Enquanto durar, ninguém lê, escreve ou entra em chamada.</p>
                </div>
              </div>
            ) : (
              <MessageListBridge conversationId={conversation.id} onOpenProfile={onOpenProfile} />
            )}
          </ChatSurfaceWidthProvider>
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

function hasFiles(e: DragEvent<HTMLDivElement>): boolean {
  return Array.from(e.dataTransfer.types).includes('Files');
}

export function MessageListBridge({ conversationId, onOpenProfile }: { conversationId: string; onOpenProfile: (userId: string) => void }) {
  const { state, setReplyingTo } = useRoom();
  const composerRef = useRef<MessageComposerHandle>(null);
  const composerWrapRef = useRef<HTMLDivElement | null>(null);
  const [composerHeight, setComposerHeight] = useState(0);
  const [dragActive, setDragActive] = useState(false);
  const dragDepthRef = useRef(0);

  useEffect(() => {
    const el = composerWrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.height;
      if (next != null) setComposerHeight(next);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  function handleDragEnter(e: DragEvent<HTMLDivElement>) {
    if (!state.joined || !hasFiles(e)) return;
    e.preventDefault();
    dragDepthRef.current += 1;
    setDragActive(true);
  }
  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    if (!state.joined || !hasFiles(e)) return;
    e.preventDefault();
  }
  function handleDragLeave(e: DragEvent<HTMLDivElement>) {
    if (!state.joined || !hasFiles(e)) return;
    e.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDragActive(false);
  }
  function handleDrop(e: DragEvent<HTMLDivElement>) {
    if (!state.joined || !hasFiles(e)) return;
    e.preventDefault();
    dragDepthRef.current = 0;
    setDragActive(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length) composerRef.current?.addFiles(files);
  }

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <MessageList conversationId={conversationId} onReply={setReplyingTo} onOpenProfile={onOpenProfile} bottomPadding={composerHeight + 24} />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 bg-linear-to-t from-bg-primary to-transparent"
        style={{ height: composerHeight + 48 }}
      />
      <div ref={composerWrapRef} className="absolute inset-x-0 bottom-0">
        <DirectComposerGate conversationId={conversationId}>
          <MessageComposer ref={composerRef} conversationId={conversationId} />
        </DirectComposerGate>
      </div>
      {dragActive && (
        <div className="pointer-events-none absolute inset-0 z-10 m-2 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-primary bg-bg-primary/90 text-text-primary">
          <Upload size={28} className="text-primary" />
          <p className="text-body font-medium">Solte para anexar</p>
        </div>
      )}
    </div>
  );
}

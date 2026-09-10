import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { MoreHorizontal, Pencil, Reply, SmilePlus, Trash2 } from 'lucide-react';
import { useRoom } from '../../state/RoomContext';
import { Avatar } from '../../shared/Avatar';
import { ChatMessageText } from './ChatMessageText';
import { ChatAttachment } from './ChatAttachment';
import { buildMentionLookup, mentionsUser } from '../../shared/lib/mentions';
import { formatTime, formatDateHeading } from '../../shared/lib/formatChatTime';
import { ALLOWED_REACTIONS } from '../../types/protocol';
import type { ChatMessage, PublicUser, ReactionEmoji } from '../../types/protocol';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { cn } from '@/shared/lib/utils';

const GROUP_GAP_MS = 5 * 60 * 1000;
const EMPTY_MESSAGES: ChatMessage[] = [];
const DELETED_AUTHOR_NAME = 'Usuario apagado';

type RenderItem =
  | { type: 'date'; key: string; label: string }
  | { type: 'message'; key: string; message: ChatMessage; showHeader: boolean };

function buildRenderItems(messages: ChatMessage[]): RenderItem[] {
  const items: RenderItem[] = [];
  let lastMsg: ChatMessage | null = null;
  let lastDateKey = '';
  for (const m of messages) {
    const dateKey = new Date(m.ts).toDateString();
    if (dateKey !== lastDateKey) {
      items.push({ type: 'date', key: `date-${dateKey}`, label: formatDateHeading(m.ts) });
      lastDateKey = dateKey;
      lastMsg = null;
    }
    const showHeader = !lastMsg || lastMsg.id !== m.id || m.ts - lastMsg.ts > GROUP_GAP_MS;
    items.push({ type: 'message', key: String(m.msgId), message: m, showHeader });
    lastMsg = m;
  }
  return items;
}

interface ChatMessageRowProps {
  message: ChatMessage;
  showHeader: boolean;
  isMod: boolean;
  isHighlighted: boolean;
  mentionLookup: Map<string, PublicUser>;
  allUsers: Map<string, PublicUser>;
  isEditing: boolean;
  editText: string;
  onEditTextChange: (text: string) => void;
  onStartEdit: () => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onReply: () => void;
  onOpenProfile: (userId: string) => void;
  onJumpTo: (msgId: number) => void;
}

function ChatMessageRow({
  message, showHeader, isMod, isHighlighted, mentionLookup, allUsers, isEditing, editText, onEditTextChange,
  onStartEdit, onSaveEdit, onCancelEdit, onReply, onOpenProfile, onJumpTo,
}: ChatMessageRowProps) {
  const { state, deleteChatMessage, reactToChatMessage } = useRoom();
  const [reactOpen, setReactOpen] = useState(false);
  const [isRowActive, setIsRowActive] = useState(false);
  const isMine = message.id === state.me.userId;
  const canDelete = isMine || isMod;
  const mentionsMe = !isMine && mentionsUser(message.text, mentionLookup, state.me.userId);
  const author = message.id ? allUsers.get(message.id) : undefined;
  const displayedName = author?.displayName ?? message.name;
  const displayedAvatar = author?.avatar ?? message.avatar;
  const replyAuthor = message.replyTo?.authorId ? allUsers.get(message.replyTo.authorId) : undefined;

  function handleEditKeyDown(e: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSaveEdit(); }
    if (e.key === 'Escape') { e.preventDefault(); onCancelEdit(); }
  }

  return (
    <div
      id={`chat-msg-${message.msgId}`}
      data-message-id={message.msgId}
      onMouseEnter={() => setIsRowActive(true)}
      onMouseLeave={() => { if (!reactOpen) setIsRowActive(false); }}
      className={cn(
        'group/msg relative flex gap-3 rounded-md border-l-2 border-transparent px-3 transition-colors',
        showHeader ? 'mt-3' : '',
        isHighlighted ? 'bg-blurple/15' : mentionsMe ? 'border-l-yellow bg-yellow/10 hover:bg-yellow/15' : 'hover:bg-bg-hover'
      )}
    >
      <div className="w-10 flex-none pt-0.5">
        {showHeader ? (
          message.id ? (
            <button
              type="button"
              aria-label={`Abrir perfil de ${displayedName}`}
              onClick={() => onOpenProfile(message.id!)}
              className="block rounded-full focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <Avatar id={message.id} name={displayedName} avatar={displayedAvatar} avatarColor={author?.avatarColor} size={40} />
            </button>
          ) : (
            <Avatar id={message.name} name={displayedName} avatar={displayedAvatar} avatarColor={author?.avatarColor} size={40} />
          )
        ) : (
          <span className="hidden select-none text-center text-caption text-text-muted group-hover/msg:block">
            {formatTime(message.ts)}
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1 py-0.5">
        {message.replyTo && (
          <button
            type="button"
            onClick={() => onJumpTo(message.replyTo!.msgId)}
            className="mb-0.5 flex max-w-full items-center gap-1.5 pl-4 text-label text-text-muted transition-colors hover:text-text-secondary focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <svg width="14" height="5" viewBox="0 0 25 8.5" fill="none" className="flex-none -translate-y-px" xmlns="http://www.w3.org/2000/svg">
              <path d="M0.5 8.5V5.5C0.5 2.73858 2.73858 0.5 5.5 0.5H25" stroke="currentColor" />
            </svg>
            {replyAuthor && (
              <Avatar id={message.replyTo.authorId ?? ''} name={replyAuthor.displayName} avatar={replyAuthor.avatar} avatarColor={replyAuthor.avatarColor} size={16} />
            )}
            <span className="flex-none font-medium">{replyAuthor?.displayName ?? DELETED_AUTHOR_NAME}</span>
            <span className="truncate">
              {message.replyTo.text || (message.replyTo.attachmentCount
                ? `📎 ${message.replyTo.attachmentCount > 1 ? `${message.replyTo.attachmentCount} anexos` : 'Anexo'}`
                : '')}
            </span>
          </button>
        )}

        {showHeader && (
          <div className="flex items-baseline gap-2">
            {message.id ? (
              <button
                type="button"
                onClick={() => onOpenProfile(message.id!)}
                className="min-w-0 truncate text-body font-semibold text-text-primary transition-colors hover:text-text-secondary hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {displayedName}
              </button>
            ) : (
              <span className="min-w-0 truncate text-body font-semibold text-text-primary">{displayedName}</span>
            )}
            <span className="text-caption text-text-muted">{formatTime(message.ts)}</span>
          </div>
        )}

        {isEditing ? (
          <div className="flex flex-col gap-1 py-0.5">
            <Textarea
              value={editText}
              onChange={(e) => onEditTextChange(e.target.value)}
              onKeyDown={handleEditKeyDown}
              autoFocus
              rows={1}
              className="min-h-8 resize-none bg-bg-textarea py-1.5 text-body"
            />
            <p className="select-none text-caption text-text-muted">escape pra cancelar · enter pra salvar</p>
          </div>
        ) : (
          <div className="text-body text-text-primary">
            <ChatMessageText text={message.text} mentionLookup={mentionLookup} myUserId={state.me.userId} />
            {message.editedAt && <span className="ml-1 select-none text-caption text-text-muted">(editado)</span>}
            {message.attachments?.map((a) => <ChatAttachment key={a.id} attachment={a} />)}
          </div>
        )}

        {message.reactions && (
          <div className="mt-1 flex flex-wrap gap-1">
            {(Object.entries(message.reactions) as [ReactionEmoji, string[]][]).map(([emoji, userIds]) => {
              if (!userIds?.length) return null;
              const mine = !!state.me.userId && userIds.includes(state.me.userId);
              return (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => reactToChatMessage(message.msgId, emoji)}
                  className={cn(
                    'flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-label transition-colors',
                    mine ? 'border-border-accent bg-blurple/15 text-text-primary' : 'border-strong bg-bg-tertiary text-text-secondary hover:bg-bg-hover'
                  )}
                >
                  <span>{emoji}</span>
                  <span>{userIds.length}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className={cn(
        'absolute right-2 top-0 z-10 hidden -translate-y-1/2 items-center gap-0.5 rounded-md border border-strong bg-bg-floating p-0.5 shadow-popover',
        isRowActive && 'md:flex'
      )}>
        <Popover open={reactOpen} onOpenChange={(open) => { setReactOpen(open); if (!open) setIsRowActive(false); }}>
          <PopoverTrigger render={<Button type="button" variant="ghost" size="icon-xs" aria-label="Reagir" />}>
            <SmilePlus size={14} />
          </PopoverTrigger>
          <PopoverContent className="w-auto p-1.5" side="top" align="end">
            <div className="flex gap-1">
              {ALLOWED_REACTIONS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => { reactToChatMessage(message.msgId, emoji); setReactOpen(false); setIsRowActive(false); }}
                  className="rounded-md p-1.5 text-[18px] leading-none transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  {emoji}
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
        {canDelete && (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Apagar"
            className="text-text-muted hover:bg-red/12 hover:text-red"
            onClick={() => deleteChatMessage(message.msgId)}
          >
            <Trash2 size={14} />
          </Button>
        )}
        <Button type="button" variant="ghost" size="icon-xs" aria-label="Responder" onClick={onReply}>
          <Reply size={14} />
        </Button>
        {isMine && (
          <Button type="button" variant="ghost" size="icon-xs" aria-label="Editar" onClick={onStartEdit}>
            <Pencil size={14} />
          </Button>
        )}
      </div>

      <div className="absolute right-1 top-1 z-10 md:hidden">
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon-xs" aria-label="Acoes da mensagem" className="bg-bg-floating/90" />}>
            <MoreHorizontal size={14} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <div className="flex gap-1 px-1 py-1">
              {ALLOWED_REACTIONS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => reactToChatMessage(message.msgId, emoji)}
                  className="rounded-md p-1.5 text-[18px] leading-none transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  {emoji}
                </button>
              ))}
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onReply}>
              <Reply size={14} />
              <span>Responder</span>
            </DropdownMenuItem>
            {isMine && (
              <DropdownMenuItem onClick={onStartEdit}>
                <Pencil size={14} />
                <span>Editar</span>
              </DropdownMenuItem>
            )}
            {canDelete && (
              <DropdownMenuItem variant="destructive" onClick={() => deleteChatMessage(message.msgId)}>
                <Trash2 size={14} />
                <span>Apagar</span>
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

interface ChatMessageListProps {
  className?: string;
  channelId: string;
  onReply: (message: ChatMessage) => void;
  onOpenProfile: (userId: string) => void;
}

export function ChatMessageList({ className, channelId, onReply, onOpenProfile }: ChatMessageListProps) {
  const {
    state, messagesByChannel, editChatMessage, allUsers, hasMoreByChannel, loadingOlderByChannel, loadOlderMessages,
    editingMsgId, setEditingMsgId, hasMoreAfterByChannel, pendingJumpTarget, clearPendingJumpTarget, openChannel,
  } = useRoom();
  const mentionLookup = useMemo(() => buildMentionLookup(allUsers), [allUsers]);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);
  const isMod = state.me.role === 'admin';
  const chatMessages = messagesByChannel.get(channelId) ?? EMPTY_MESSAGES;
  const hasMoreHistory = hasMoreByChannel.get(channelId) !== false;
  const isLoadingOlder = loadingOlderByChannel.has(channelId);
  const pendingPrependRef = useRef(false);
  const prevScrollHeightRef = useRef(0);
  const wasLoadingOlderRef = useRef(false);

  const [editText, setEditText] = useState('');
  const [highlightedMsgId, setHighlightedMsgId] = useState<number | null>(null);
  const highlightTimeoutRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    stickToBottomRef.current = true;
    pendingPrependRef.current = false;
    wasLoadingOlderRef.current = false;
  }, [channelId]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [chatMessages]);

  useEffect(() => {
    const scrollEl = scrollRef.current;
    const contentEl = contentRef.current;
    if (!scrollEl || !contentEl) return;

    function handleScroll() {
      const el = scrollEl!;
      stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    }
    const resizeObserver = new ResizeObserver(() => {
      if (stickToBottomRef.current) scrollEl.scrollTop = scrollEl.scrollHeight;
    });
    resizeObserver.observe(contentEl);
    scrollEl.addEventListener('scroll', handleScroll);
    return () => {
      resizeObserver.disconnect();
      scrollEl.removeEventListener('scroll', handleScroll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    function handleTopScroll() {
      if (el!.scrollTop > 100) return;
      if (pendingPrependRef.current || isLoadingOlder || !hasMoreHistory) return;
      pendingPrependRef.current = true;
      prevScrollHeightRef.current = el!.scrollHeight;
      loadOlderMessages(channelId);
    }
    el.addEventListener('scroll', handleTopScroll);
    return () => el.removeEventListener('scroll', handleTopScroll);
  }, [channelId, hasMoreHistory, isLoadingOlder, loadOlderMessages]);

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
  }, [isLoadingOlder, chatMessages]);

  const lastMineTsRef = useRef(0);
  useEffect(() => {
    const last = chatMessages[chatMessages.length - 1];
    if (last && last.id === state.me.userId && last.ts !== lastMineTsRef.current) {
      lastMineTsRef.current = last.ts;
      stickToBottomRef.current = true;
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [chatMessages, state.me.userId]);

  const renderItems = useMemo(() => buildRenderItems(chatMessages), [chatMessages]);

  useEffect(() => {
    if (editingMsgId == null) return;
    const msg = chatMessages.find((m) => m.msgId === editingMsgId);
    if (msg) setEditText(msg.text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingMsgId]);

  function startEdit(message: ChatMessage) {
    setEditingMsgId(message.msgId);
  }
  function saveEdit() {
    const trimmed = editText.trim();
    if (editingMsgId != null && trimmed) editChatMessage(editingMsgId, trimmed);
    setEditingMsgId(null);
  }

  function jumpToMessage(msgId: number, behavior: ScrollBehavior = 'smooth') {
    const el = document.getElementById(`chat-msg-${msgId}`);
    if (!el) return;
    el.scrollIntoView({ behavior, block: 'center' });
    if (highlightTimeoutRef.current != null) window.clearTimeout(highlightTimeoutRef.current);
    setHighlightedMsgId(msgId);
    highlightTimeoutRef.current = window.setTimeout(() => setHighlightedMsgId(null), 1500);
  }

  useLayoutEffect(() => {
    if (!pendingJumpTarget || pendingJumpTarget.channelId !== channelId) return;
    if (!chatMessages.some((m) => m.msgId === pendingJumpTarget.msgId)) return;
    stickToBottomRef.current = false;
    jumpToMessage(pendingJumpTarget.msgId, 'auto');
    clearPendingJumpTarget();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingJumpTarget, chatMessages, channelId]);

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={scrollRef} className={`h-full overflow-y-auto ${className ?? ''}`}>
        <div ref={contentRef} className="flex flex-col">
          {isLoadingOlder && (
            <p className="my-2 select-none px-1 text-center text-label text-text-muted">Carregando mensagens anteriores…</p>
          )}
          {chatMessages.length === 0 && (
            <p className="mt-4 select-none px-1 text-center text-label text-text-muted">Nenhuma mensagem ainda. Diga oi!</p>
          )}
          {renderItems.map((item) => {
            if (item.type === 'date') {
              return (
                <div key={item.key} className="my-3 flex select-none items-center gap-3 px-3">
                  <div className="h-px flex-1 bg-border-strong" />
                  <span className="flex-none text-caption font-medium text-text-muted">{item.label}</span>
                  <div className="h-px flex-1 bg-border-strong" />
                </div>
              );
            }
            const { message, showHeader } = item;
            return (
              <ChatMessageRow
                key={item.key}
                message={message}
                showHeader={showHeader}
                isMod={isMod}
                isHighlighted={highlightedMsgId === message.msgId}
                mentionLookup={mentionLookup}
                allUsers={allUsers}
                isEditing={editingMsgId === message.msgId}
                editText={editText}
                onEditTextChange={setEditText}
                onStartEdit={() => startEdit(message)}
                onSaveEdit={saveEdit}
                onCancelEdit={() => setEditingMsgId(null)}
                onReply={() => onReply(message)}
                onOpenProfile={onOpenProfile}
                onJumpTo={jumpToMessage}
              />
            );
          })}
        </div>
      </div>
      {hasMoreAfterByChannel.get(channelId) === true && (
        <button
          type="button"
          onClick={() => { stickToBottomRef.current = true; openChannel(channelId); }}
          className="absolute bottom-4 left-1/2 -translate-x-1/2 select-none rounded-full bg-blurple px-3 py-1.5 text-label font-medium text-white shadow-popover transition-colors hover:bg-blurple-hover focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          Voltar para o mais recente
        </button>
      )}
    </div>
  );
}

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { LoaderCircle, MoreHorizontal, Pencil, Reply, RotateCcw, SmilePlus, Trash2, TriangleAlert } from 'lucide-react';
import { useRoom } from '../../state/RoomContext';
import { Avatar } from '../../shared/Avatar';
import { ChatMessageText } from './ChatMessageText';
import { ChatAttachment } from './ChatAttachment';
import { buildMentionLookup, mentionsUser } from '../../shared/lib/mentions';
import { ALLOWED_REACTIONS } from '../../types/protocol';
import type { ChatMessage, PublicUser, ReactionEmoji } from '../../types/protocol';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { cn } from '@/shared/lib/utils';
import { ConfirmDialog } from '../../shared/ConfirmDialog';

// consecutive messages from the same author within this window group
// together (avatar/name only on the first) — same idea as Discord.
const GROUP_GAP_MS = 5 * 60 * 1000;
// stable reference — reused instead of a new `[]` on every render for a
// channel whose history hasn't loaded yet.
const EMPTY_MESSAGES: ChatMessage[] = [];

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function formatDateHeading(ts: number): string {
  return new Date(ts).toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
}

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
      lastMsg = null; // forces the author header to show again after the date divider
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
  isEditing: boolean;
  editText: string;
  onEditTextChange: (text: string) => void;
  onStartEdit: () => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onReply: () => void;
  onJumpTo: (msgId: number) => void;
}

/** One row in history — no bubble, continuous background. `showHeader`
 * decides whether to show avatar/name (first in a run from the same
 * author) or stay compact (just the time, on hover, where the avatar
 * would be). */
function ChatMessageRow({
  message, showHeader, isMod, isHighlighted, mentionLookup, isEditing, editText, onEditTextChange,
  onStartEdit, onSaveEdit, onCancelEdit, onReply, onJumpTo,
}: ChatMessageRowProps) {
  const { state, deleteChatMessage, reactToChatMessage, retryChatMessage, discardFailedChatMessage } = useRoom();
  const [reactOpen, setReactOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  // A pending/failed message only exists on this client — it has no real
  // msgId yet, so reacting/replying/editing/deleting it server-side is
  // meaningless. Its own retry/discard controls replace the usual actions.
  const isSending = message.pending === 'sending';
  const isFailed = message.pending === 'failed';
  // a CSS-only bar (group-hover) would close as soon as the mouse left the
  // row to reach the popover/dropdown — those portal outside the row's DOM
  // tree, so ":hover" on the row stops applying partway there. Hover
  // becomes state here instead: stays "active" while a popover/dropdown
  // from this row is open, even with the mouse physically outside it.
  const [isRowActive, setIsRowActive] = useState(false);
  // message.id is the account's USERID (not a connection id) — compare
  // against state.me.userId, not state.me.id, or "is this my message?"
  // breaks after reconnecting/reloading (connection id changes, userId doesn't).
  const isMine = message.id === state.me.userId;
  const canDelete = isMine || isMod;
  // own messages never "highlight for being mentioned" — mentioning
  // yourself isn't a notification.
  const mentionsMe = !isMine && mentionsUser(message.text, mentionLookup, state.me.userId);

  function handleEditKeyDown(e: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSaveEdit(); }
    if (e.key === 'Escape') { e.preventDefault(); onCancelEdit(); }
  }

  return (
    <div
      id={`chat-msg-${message.msgId}`}
      onMouseEnter={() => setIsRowActive(true)}
      onMouseLeave={() => { if (!reactOpen && !moreOpen) setIsRowActive(false); }}
      className={cn(
        'group/msg relative flex gap-3 rounded-md border-l-2 border-transparent px-3 transition-colors',
        showHeader ? 'mt-3' : '',
        isHighlighted ? 'bg-blurple/15' : mentionsMe ? 'border-l-yellow bg-yellow/10 hover:bg-yellow/15' : 'hover:bg-bg-hover'
      )}
    >
      <div className="w-10 flex-none pt-0.5">
        {/* message.id (authorId) becomes null when the sender's account was
            deleted — falls back to the frozen name as the color seed, just
            so every deleted author doesn't get the SAME color. */}
        {showHeader ? (
          <Avatar id={message.id ?? message.name} name={message.name} avatar={message.avatar} size={40} />
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
            {/* Discord's curved reply connector (from their Figma kit) — a
                custom SVG instead of a generic arrow icon; stroke="currentColor"
                to follow the text color (same hover/normal as the rest of the row). */}
            <svg width="14" height="5" viewBox="0 0 25 8.5" fill="none" className="flex-none -translate-y-px" xmlns="http://www.w3.org/2000/svg">
              <path d="M0.5 8.5V5.5C0.5 2.73858 2.73858 0.5 5.5 0.5H25" stroke="currentColor" />
            </svg>
            <span className="flex-none font-medium">{message.replyTo.name}</span>
            <span className="truncate">{message.replyTo.text}</span>
          </button>
        )}

        {showHeader && (
          <div className="flex items-baseline gap-2">
            <span className="text-body font-semibold text-text-primary">{message.name}</span>
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
          <div className={cn('text-body text-text-primary', isSending && 'opacity-60')}>
            <ChatMessageText text={message.text} mentionLookup={mentionLookup} myUserId={state.me.userId} />
            {message.editedAt && <span className="ml-1 select-none text-caption text-text-muted">(editado)</span>}
            {message.attachment && <ChatAttachment attachment={message.attachment} />}
          </div>
        )}

        {isSending && (
          <div className="mt-0.5 flex items-center gap-1 text-caption text-text-muted">
            <LoaderCircle size={12} className="animate-spin" aria-hidden="true" />
            <span>Enviando...</span>
          </div>
        )}
        {isFailed && (
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-red">
            <span className="flex items-center gap-1">
              <TriangleAlert size={12} aria-hidden="true" />
              Falha ao enviar
            </span>
            <button
              type="button"
              onClick={() => retryChatMessage(message.channelId, message.clientId!)}
              className="flex items-center gap-1 font-medium hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <RotateCcw size={12} aria-hidden="true" />
              Tentar novamente
            </button>
            <button
              type="button"
              onClick={() => discardFailedChatMessage(message.channelId, message.clientId!)}
              className="text-text-muted hover:text-text-secondary hover:underline focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              Descartar
            </button>
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

      {/* desktop only — hover-revealed (see isRowActive above); touch has
          no hover, so mobile gets a single always-visible trigger instead
          (below) that opens the same actions in one menu. Neither bar makes
          sense for a message that has no real msgId yet (see isSending/
          isFailed above and their own retry/discard controls). */}
      {!isSending && !isFailed && (
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
          <Button type="button" variant="ghost" size="icon-xs" aria-label="Responder" onClick={onReply}>
            <Reply size={14} />
          </Button>
          {isMine && (
            <Button type="button" variant="ghost" size="icon-xs" aria-label="Editar" onClick={onStartEdit}>
              <Pencil size={14} />
            </Button>
          )}
          {canDelete && (
            <DropdownMenu onOpenChange={(open) => { setMoreOpen(open); if (!open) setIsRowActive(false); }}>
              <DropdownMenuTrigger render={<Button type="button" variant="ghost" size="icon-xs" aria-label="Mais opcoes" />}>
                <MoreHorizontal size={14} />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem variant="destructive" onClick={() => setDeleteConfirmOpen(true)}>
                  <Trash2 size={14} />
                  <span>Apagar</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      )}

      {/* mobile only — one always-visible trigger (no hover on touch)
          bundling react/reply/edit/delete into a single menu instead of
          four separate hover buttons. */}
      {!isSending && !isFailed && (
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
                <DropdownMenuItem variant="destructive" onClick={() => setDeleteConfirmOpen(true)}>
                  <Trash2 size={14} />
                  <span>Apagar</span>
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
      <ConfirmDialog
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        title="Apagar mensagem"
        description={
          isMine
            ? 'Sua mensagem sera apagada para todos. Essa acao nao pode ser desfeita.'
            : `A mensagem de ${message.name} sera apagada para todos. Essa acao nao pode ser desfeita.`
        }
        confirmLabel="Apagar"
        destructive
        onConfirm={() => deleteChatMessage(message.msgId)}
      />
    </div>
  );
}

interface ChatMessageListProps {
  className?: string;
  channelId: string;
  onReply: (message: ChatMessage) => void;
}

/** Chat history — Discord-style: no bubbles, continuous background,
 * messages grouped by author, date divider, and a per-message action bar
 * on hover (react/reply/edit/delete). */
export function ChatMessageList({ className, channelId, onReply }: ChatMessageListProps) {
  const { state, messagesByChannel, editChatMessage, allUsers } = useRoom();
  const mentionLookup = useMemo(() => buildMentionLookup(allUsers), [allUsers]);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // wraps ONLY the content (not the scrolling viewport) — with
  // overflow-y-auto, the viewport has a fixed size (doesn't grow with
  // content), so a ResizeObserver ON IT never fires for a new message/
  // image. The div that grows is this inner one; that's what needs
  // observing (see the effect below).
  const contentRef = useRef<HTMLDivElement | null>(null);
  // true while the user is "stuck" to the bottom (or hasn't scrolled
  // anywhere yet) — only then does new content (a message, or an image/
  // attachment that only gains real height AFTER loading) auto-adjust the
  // scroll; if they scrolled up to read history, nothing here should pull
  // them back down.
  const stickToBottomRef = useRef(true);
  const isMod = state.me.role === 'admin';
  const chatMessages = messagesByChannel.get(channelId) ?? EMPTY_MESSAGES;

  const [editingMsgId, setEditingMsgId] = useState<number | null>(null);
  const [editText, setEditText] = useState('');
  const [highlightedMsgId, setHighlightedMsgId] = useState<number | null>(null);
  const highlightTimeoutRef = useRef<number | null>(null);

  // switching channels ALWAYS starts at the bottom (most recent message) —
  // never preserves another channel's scroll position. A layout effect (not
  // a regular one) so it resolves before the next effect below reads it,
  // even when both fire in the same commit (channelId and chatMessages
  // usually change together on a channel switch).
  useLayoutEffect(() => {
    stickToBottomRef.current = true;
  }, [channelId]);

  // whenever the rendered list actually changes — a new/edited/deleted
  // message, a reaction, or history just arriving for a freshly opened
  // channel — jump to the bottom synchronously (before paint) if still
  // stuck there. This is what keeps the view pinned to new messages;
  // depending only on the ResizeObserver below left a gap where the first
  // paint of newly arrived history could show the TOP of the channel
  // instead of the bottom.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [chatMessages]);

  // "stuck to bottom" (see stickToBottomRef above) via a ResizeObserver on
  // the CONTENT (not the message count): covers content that only gains
  // real height AFTER the layout effect above already ran — a loading
  // image/attachment (ChatAttachment), a link preview (ChatEmbed) —
  // without this, the scroll position would be "correct" while the image
  // still had no height, then fall behind once it finished loading.
  useEffect(() => {
    const scrollEl = scrollRef.current;
    const contentEl = contentRef.current;
    if (!scrollEl || !contentEl) return;

    function handleScroll() {
      const el = scrollEl!;
      // a few px of tolerance so "at the bottom" doesn't require pixel-perfect
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
    // attaches only once — scrollRef/contentRef are the SAME DOM nodes for
    // the component's whole lifetime (doesn't remount on channel switch),
    // no need to recreate the observer/listener each time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // MY OWN message sent now always pulls to the bottom, even if I'd
  // scrolled up before sending — I just wrote it, makes sense to see it
  // appear (someone ELSE's message doesn't force this, it only sticks if I
  // was already at the bottom, see the ResizeObserver above).
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

  function startEdit(message: ChatMessage) {
    setEditingMsgId(message.msgId);
    setEditText(message.text);
  }
  function saveEdit() {
    const trimmed = editText.trim();
    if (editingMsgId != null && trimmed) editChatMessage(editingMsgId, trimmed);
    setEditingMsgId(null);
  }

  function jumpToMessage(msgId: number) {
    const el = document.getElementById(`chat-msg-${msgId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (highlightTimeoutRef.current != null) window.clearTimeout(highlightTimeoutRef.current);
    setHighlightedMsgId(msgId);
    highlightTimeoutRef.current = window.setTimeout(() => setHighlightedMsgId(null), 1500);
  }

  return (
    <div ref={scrollRef} className={`min-h-0 flex-1 overflow-y-auto ${className ?? ''}`}>
      <div ref={contentRef} className="flex flex-col">
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
              isEditing={editingMsgId === message.msgId}
              editText={editText}
              onEditTextChange={setEditText}
              onStartEdit={() => startEdit(message)}
              onSaveEdit={saveEdit}
              onCancelEdit={() => setEditingMsgId(null)}
              onReply={() => onReply(message)}
              onJumpTo={jumpToMessage}
            />
          );
        })}
      </div>
    </div>
  );
}

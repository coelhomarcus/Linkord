import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { buildMentionLookup } from '@/shared/lib/mentions';
import { useRoom } from '@/state/RoomContext';
import type { ChatMessage } from '@/shared/types/protocol';
import { MessageRow } from './MessageRow';
import { buildTimelineItems } from './messageTimelineItems';

const EMPTY_MESSAGES: ChatMessage[] = [];

export function MessageTimeline({ conversationId, onReply, onOpenProfile, bottomPadding }: {
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
  const items = useMemo(() => buildTimelineItems(messages), [messages]);

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
    // scroll-area padding — see ChatSurface) starts at a guess and
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
    // scoped to this list: the call panel can show the same conversation at
    // the same time, and a document-wide lookup would scroll the other one
    const el = scrollRef.current?.querySelector(`[data-msg-id="${msgId}"]`);
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
        <div ref={contentRef} className="flex w-full flex-col">
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

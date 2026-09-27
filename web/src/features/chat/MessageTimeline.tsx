import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { defaultRangeExtractor, useVirtualizer, type Range } from '@tanstack/react-virtual';
import { ArrowDown } from 'lucide-react';
import { buildMentionLookup } from '@/shared/lib/mentions';
import { useRoom } from '@/state/RoomContext';
import type { ChatMessage } from '@/shared/types/protocol';
import { MessageRow } from './MessageRow';
import { buildTimelineItems, type TimelineItem } from './messageTimelineItems';
import type { OutboxEntry } from './useMessageOutbox';

const EMPTY_MESSAGES: ChatMessage[] = [];
const EMPTY_PENDING: OutboxEntry[] = [];
// Within this distance of the bottom the list counts as "at the present"
// and follows new messages; farther up, the reader's place is kept.
const AT_END_THRESHOLD = 80;
// Rows from an edge at which the next page is requested.
const PAGE_TRIGGER_ROWS = 3;
const HIGHLIGHT_MS = 1500;

/** First guess at a row's height before it's measured; only affects how
 * far off the scrollbar is until then. */
function estimateSize(item: TimelineItem | undefined): number {
  if (!item) return 40;
  if (item.type === 'date') return 44;
  const message = item.message;
  let size = item.showHeader ? 62 : 26;
  size += Math.floor(message.text.length / 90) * 22;
  if (message.replyTo) size += 22;
  if (message.attachments?.length) size += 260;
  if (message.reactions && Object.keys(message.reactions).length) size += 30;
  return size;
}

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
    loadingNewerByConversation,
    loadNewerMessages,
    newerCountByConversation,
    pendingJumpTarget,
    clearPendingJumpTarget,
    jumpToMessage,
    openConversation,
    pendingByConversation,
    editingMsgId,
    state,
  } = useRoom();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [highlightedMsgId, setHighlightedMsgId] = useState<number | null>(null);
  const highlightTimeoutRef = useRef<number | null>(null);
  const mentionLookup = useMemo(() => buildMentionLookup(allUsers), [allUsers]);
  const messages = messagesByConversation.get(conversationId) ?? EMPTY_MESSAGES;
  const hasMoreBefore = hasMoreByConversation.get(conversationId) !== false;
  const hasMoreAfter = hasMoreAfterByConversation.get(conversationId) === true;
  const isLoadingOlder = loadingOlderByConversation.has(conversationId);
  const isLoadingNewer = loadingNewerByConversation.has(conversationId);
  const pending = pendingByConversation.get(conversationId) ?? EMPTY_PENDING;
  const { userId: myUserId, displayName: myName, avatar: myAvatar } = state.me;
  const items = useMemo(
    () => buildTimelineItems(messages, pending, { userId: myUserId, name: myName, avatar: myAvatar }),
    [messages, pending, myUserId, myName, myAvatar],
  );

  // An open editor must survive scrolling away: its row stays mounted even
  // outside the rendered range (it's the only exception, and it's one row).
  const editingIndex = editingMsgId == null ? -1 : items.findIndex((item) => item.type === 'message' && item.message.msgId === editingMsgId);
  const rangeExtractor = useCallback((range: Range) => {
    const indexes = defaultRangeExtractor(range);
    if (editingIndex < 0 || indexes.includes(editingIndex)) return indexes;
    return [...indexes, editingIndex].sort((a, b) => a - b);
  }, [editingIndex]);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => estimateSize(items[index]),
    getItemKey: (index) => items[index]?.key ?? index,
    overscan: 8,
    // the library keeps the first visible row (and the offset inside it)
    // in place when rows are added above, and follows appends at the end
    anchorTo: 'end',
    // only at the real present: at the end of an older window a newer page
    // must keep the reader's place, or following it would request the next
    // page, and the next, all the way to the present on its own
    followOnAppend: !hasMoreAfter,
    scrollEndThreshold: AT_END_THRESHOLD,
    paddingStart: 12,
    paddingEnd: bottomPadding,
    rangeExtractor,
  });
  const virtualItems = virtualizer.getVirtualItems();

  const jumpIndex = pendingJumpTarget && pendingJumpTarget.conversationId === conversationId
    ? items.findIndex((item) => item.type === 'message' && item.message.msgId === pendingJumpTarget.msgId)
    : -1;

  // Mounted per window (ChatSurface keys it), so this runs once: start on
  // the jump target when there is one, at the present otherwise. Paging
  // waits for it, or the first render — sitting at the top before this
  // scroll — would fetch history nobody asked for.
  const [ready, setReady] = useState(false);
  useLayoutEffect(() => {
    if (ready || !items.length) return;
    if (jumpIndex >= 0) {
      // the jump effect below centers it again once rows are measured, and
      // highlights it
      virtualizer.scrollToIndex(jumpIndex, { align: 'center' });
    } else {
      virtualizer.scrollToIndex(items.length - 1, { align: 'end' });
    }
    const frame = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(frame);
  }, [ready, items, jumpIndex, virtualizer]);

  // Your own send brings you back to the present, even from old history.
  const pendingCount = pending.length;
  const prevPendingCountRef = useRef(pendingCount);
  useEffect(() => {
    if (pendingCount > prevPendingCountRef.current) virtualizer.scrollToIndex(items.length - 1, { align: 'end' });
    prevPendingCountRef.current = pendingCount;
  }, [pendingCount, items.length, virtualizer]);

  const firstIndex = virtualItems[0]?.index ?? 0;
  const lastIndex = virtualItems[virtualItems.length - 1]?.index ?? 0;
  useEffect(() => {
    if (!ready || !items.length) return;
    if (firstIndex <= PAGE_TRIGGER_ROWS && hasMoreBefore && !isLoadingOlder) loadOlderMessages(conversationId);
    if (lastIndex >= items.length - 1 - PAGE_TRIGGER_ROWS && hasMoreAfter && !isLoadingNewer) loadNewerMessages(conversationId);
  }, [ready, firstIndex, lastIndex, items.length, hasMoreBefore, hasMoreAfter, isLoadingOlder, isLoadingNewer, loadOlderMessages, loadNewerMessages, conversationId]);

  // "At the present" drives the new-messages pill: messages appended while
  // reading above are counted instead of yanking the view down.
  const [atEnd, setAtEnd] = useState(true);
  const [unseen, setUnseen] = useState(0);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const end = el.scrollHeight - el.scrollTop - el.clientHeight <= AT_END_THRESHOLD;
      setAtEnd(end);
      if (end) setUnseen(0);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);
  const lastKey = items[items.length - 1]?.key;
  const prevLastKeyRef = useRef(lastKey);
  const prevLengthRef = useRef(items.length);
  useEffect(() => {
    if (ready && lastKey !== prevLastKeyRef.current && !atEnd && items.length > prevLengthRef.current) {
      setUnseen((count) => count + (items.length - prevLengthRef.current));
    }
    prevLastKeyRef.current = lastKey;
    prevLengthRef.current = items.length;
  }, [lastKey, items.length, atEnd, ready]);

  const highlight = useCallback((msgId: number) => {
    if (highlightTimeoutRef.current != null) window.clearTimeout(highlightTimeoutRef.current);
    setHighlightedMsgId(msgId);
    highlightTimeoutRef.current = window.setTimeout(() => setHighlightedMsgId(null), HIGHLIGHT_MS);
  }, []);

  /** By index in this list's own data, not a DOM lookup: the target may be
   * loaded but not mounted, and another surface may show the same rows. */
  const scrollToMessage = useCallback((msgId: number): boolean => {
    const index = items.findIndex((item) => item.type === 'message' && item.message.msgId === msgId);
    if (index < 0) return false;
    virtualizer.scrollToIndex(index, { align: 'center' });
    highlight(msgId);
    return true;
  }, [items, virtualizer, highlight]);

  const onJumpTo = useCallback((msgId: number) => {
    // not in this window: load one around it (then the effect below lands)
    if (!scrollToMessage(msgId)) jumpToMessage(conversationId, msgId);
  }, [scrollToMessage, jumpToMessage, conversationId]);

  useEffect(() => {
    if (!ready || !pendingJumpTarget || pendingJumpTarget.conversationId !== conversationId) return;
    if (scrollToMessage(pendingJumpTarget.msgId)) clearPendingJumpTarget();
  }, [ready, pendingJumpTarget, conversationId, scrollToMessage, clearPendingJumpTarget]);

  useEffect(() => () => {
    if (highlightTimeoutRef.current != null) window.clearTimeout(highlightTimeoutRef.current);
  }, []);

  const newerCount = newerCountByConversation.get(conversationId) ?? 0;
  const pill = hasMoreAfter
    ? { label: newerCount ? `${newerCount} ${newerCount === 1 ? 'mensagem nova' : 'mensagens novas'} · voltar ao presente` : 'Voltar para o mais recente', onClick: () => openConversation(conversationId) }
    : !atEnd && unseen > 0
      ? { label: `${unseen} ${unseen === 1 ? 'mensagem nova' : 'mensagens novas'}`, onClick: () => virtualizer.scrollToIndex(items.length - 1, { align: 'end', behavior: 'smooth' }) }
      : null;

  return (
    <div className="relative min-h-0 flex-1">
      {/* overflow-anchor off: the virtualizer already keeps the reading
          position; the browser's own anchoring would compensate twice */}
      <div ref={scrollRef} data-scroll-root className="h-full overflow-y-auto px-2 [overflow-anchor:none]">
        {isLoadingOlder && <p className="absolute inset-x-0 top-2 z-10 text-center text-label text-text-muted">Carregando mensagens anteriores...</p>}
        {items.length === 0 ? (
          <div className="flex min-h-[45vh] items-center justify-center px-6 text-center text-label text-text-muted">
            Nenhuma mensagem ainda.
          </div>
        ) : (
          <div role="log" aria-label="Mensagens" className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
            {virtualItems.map((virtualItem) => {
              const item = items[virtualItem.index]!;
              return (
                <div
                  key={virtualItem.key}
                  data-index={virtualItem.index}
                  ref={virtualizer.measureElement}
                  // flow-root keeps the row's own margins inside the box
                  // that gets measured, so spacing never drifts the math
                  className="absolute inset-x-0 top-0 flow-root"
                  style={{ transform: `translateY(${virtualItem.start}px)` }}
                >
                  {item.type === 'date' ? (
                    <div className="my-4 flex select-none items-center justify-center px-4">
                      <span className="flex-none text-caption font-medium text-text-muted opacity-60">{item.label}</span>
                    </div>
                  ) : (
                    <MessageRow
                      message={item.message}
                      showHeader={item.showHeader}
                      highlighted={highlightedMsgId === item.message.msgId}
                      pending={item.pending}
                      allUsers={allUsers}
                      mentionLookup={mentionLookup}
                      onReply={() => onReply(item.message)}
                      onOpenProfile={onOpenProfile}
                      onJumpTo={onJumpTo}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      {pill && (
        <button
          type="button"
          onClick={pill.onClick}
          style={{ bottom: bottomPadding + 16 }}
          className="absolute left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-label font-medium text-primary-foreground shadow-popover"
        >
          <ArrowDown size={14} />
          {pill.label}
        </button>
      )}
    </div>
  );
}

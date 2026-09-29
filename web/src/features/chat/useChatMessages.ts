import { useCallback, useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import { playSound } from '@/shared/sounds';
import { notifyIncomingChatMessage } from '@/shared/notifications';
import { messagePreviewText } from '@/features/chat/messagePreview';
import { mentionsUsername } from '@/shared/lib/mentions';
import { useMessageOutbox } from './useMessageOutbox';
import { useMessageActionRequests } from './useMessageActionRequests';
import { useReactionIntents } from './useReactionIntents';
import { MAX_WINDOW, withNewerMessages, withOlderPage } from './historyWindow';
import { markArrival } from './arrivals';
import type { ReactionParticipantsTarget } from './reactionParticipants';
import type { ChatMessage, ClientMessage, Conversation, PublicUser, ReactionEmoji, ServerMessage } from '@/shared/types/protocol';

/** Adds `message` once, in msgId order — a send's result and its broadcast
 * both deliver it, in either order, and it may land after newer messages. */
function withMessage(list: ChatMessage[], message: ChatMessage): ChatMessage[] {
  if (list.some((existing) => existing.msgId === message.msgId)) return list;
  let index = list.length;
  while (index > 0 && list[index - 1]!.msgId > message.msgId) index--;
  return [...list.slice(0, index), message, ...list.slice(index)];
}

// Conversations whose history stays in memory once you've moved on; older
// ones are dropped and fetched again when reopened. Unsent messages live in
// the outbox and drafts in their own store, so neither goes with them.
const MAX_CACHED_CONVERSATIONS = 5;

// A page request that never gets an answer mustn't leave its direction
// "loading" forever — after this the user can scroll to try again.
const PAGE_TIMEOUT_MS = 10_000;

function updateSet(set: Set<string>, id: string, present: boolean): Set<string> {
  if (set.has(id) === present) return set;
  const next = new Set(set);
  if (present) next.add(id); else next.delete(id);
  return next;
}

function displayNameForConversation(conversation: Conversation | undefined, meUserId: string | null, users: Map<string, PublicUser>): string {
  if (!conversation) return 'Conversa';
  if (conversation.type === 'group') return conversation.title || 'Grupo';
  const otherId = conversation.memberIds.find((id) => id !== meUserId) ?? conversation.memberIds[0];
  const other = otherId ? users.get(otherId) : undefined;
  return other?.displayName || other?.username || 'Conversa direta';
}

interface ChatMessagesDeps {
  sendWs: (msg: ClientMessage) => boolean;
  // Read-only cross-domain context — chat message handling genuinely needs
  // all of these (deciding unread/notify-sound/typing-clear on arrival,
  // moving the active-conversation cursor on jump), but none of them are
  // OWNED here; they stay wherever their own domain hook already keeps them.
  // `setActiveConversation` is the BARE cursor-mover from useConversationsList
  // (not its composed "open a conversation" behavior) — jumpToMessage below
  // clears ITS OWN unread/reply/editing state directly instead, since those
  // three already live in this same hook.
  activeConversationIdRef: MutableRefObject<string | null>;
  setActiveConversation: (conversationId: string) => void;
  conversationsRef: MutableRefObject<Conversation[]>;
  allUsersRef: MutableRefObject<Map<string, PublicUser>>;
  myUserIdRef: MutableRefObject<string | null>;
  myUsernameRef: MutableRefObject<string | null>;
  activeViewRef: MutableRefObject<'chat' | 'call'>;
  clearTypingEntry: (conversationId: string, userId: string) => void;
}

/** Message history + composition state for every open conversation:
 * fetching/paginating, sending/editing/deleting, jumping to a search
 * result, and applying the handful of server broadcasts that patch an
 * existing message in place (edit, attachment added, reaction changed). */
export function useChatMessages(deps: ChatMessagesDeps) {
  const { sendWs, activeConversationIdRef, setActiveConversation, conversationsRef, allUsersRef, myUserIdRef, myUsernameRef, activeViewRef, clearTypingEntry } = deps;

  const [messagesByConversation, setMessagesByConversation] = useState<Map<string, ChatMessage[]>>(new Map());
  const messagesByConversationRef = useRef<Map<string, ChatMessage[]>>(new Map());
  useEffect(() => { messagesByConversationRef.current = messagesByConversation; }, [messagesByConversation]);
  const [hasMoreByConversation, setHasMoreByConversation] = useState<Map<string, boolean>>(new Map());
  const hasMoreByConversationRef = useRef<Map<string, boolean>>(new Map());
  useEffect(() => { hasMoreByConversationRef.current = hasMoreByConversation; }, [hasMoreByConversation]);
  const [hasMoreAfterByConversation, setHasMoreAfterByConversation] = useState<Map<string, boolean>>(new Map());
  const hasMoreAfterRef = useRef<Map<string, boolean>>(new Map());
  useEffect(() => { hasMoreAfterRef.current = hasMoreAfterByConversation; }, [hasMoreAfterByConversation]);
  const [loadingOlderByConversation, setLoadingOlderByConversation] = useState<Set<string>>(new Set());
  const [loadingNewerByConversation, setLoadingNewerByConversation] = useState<Set<string>>(new Set());
  // live messages that arrived while a conversation shows an older window:
  // not inserted (that would leave a hidden gap), just counted
  const [newerCountByConversation, setNewerCountByConversation] = useState<Map<string, number>>(new Map());
  // bumped whenever a conversation's window is replaced wholesale (opened
  // at the present, or around a jump target) rather than extended: the
  // timeline starts over from its new position instead of keeping a scroll
  // offset that belonged to rows no longer there
  const [windowGenerationByConversation, setWindowGeneration] = useState<Map<string, number>>(new Map());
  const recentConversationsRef = useRef<string[]>([]);
  const touchConversationCache = useCallback((conversationId: string) => {
    const recent = [conversationId, ...recentConversationsRef.current.filter((id) => id !== conversationId)];
    const evicted = recent.slice(MAX_CACHED_CONVERSATIONS);
    recentConversationsRef.current = recent.slice(0, MAX_CACHED_CONVERSATIONS);
    if (!evicted.length) return;
    const drop = <V,>(prev: Map<string, V>) => {
      if (!evicted.some((id) => prev.has(id))) return prev;
      const next = new Map(prev);
      for (const id of evicted) next.delete(id);
      return next;
    };
    setMessagesByConversation(drop);
    setHasMoreByConversation(drop);
    setHasMoreAfterByConversation(drop);
    setNewerCountByConversation(drop);
  }, []);
  const bumpWindow = useCallback((conversationId: string) => {
    setWindowGeneration((prev) => new Map(prev).set(conversationId, (prev.get(conversationId) ?? 0) + 1));
  }, []);
  // one outstanding page per conversation+direction; a reply carrying any
  // other requestId answers something since replaced (a jump, a reload)
  const pageRequestsRef = useRef(new Map<string, { requestId: string; timer: ReturnType<typeof setTimeout> }>());
  const [unreadByConversation, setUnreadByConversation] = useState<Map<string, number>>(new Map());
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [editingMsgId, setEditingMsgId] = useState<number | null>(null);
  // which message's full reaction list is open — shared by the row menu and
  // the right-click menu, since both need to open the same single dialog
  const [reactionParticipantsTarget, setReactionParticipantsTarget] = useState<ReactionParticipantsTarget | null>(null);
  const openReactionParticipants = useCallback((target: ReactionParticipantsTarget) => setReactionParticipantsTarget(target), []);
  const closeReactionParticipants = useCallback(() => setReactionParticipantsTarget(null), []);
  const actionRequests = useMessageActionRequests(sendWs);
  const { request: requestAction } = actionRequests;
  // shared by the row and the right-click menu, which both delete
  const [deletingMsgIds, setDeletingMsgIds] = useState<Set<number>>(new Set());
  const [messageActionErrors, setMessageActionErrors] = useState<Map<number, string>>(new Map());
  const onReactionError = useCallback((msgId: number, message: string) => {
    setMessageActionErrors((prev) => new Map(prev).set(msgId, `Não foi possível reagir: ${message}`));
  }, []);
  const reactionIntents = useReactionIntents({ request: requestAction, onError: onReactionError });
  const { react: reactWithIntent } = reactionIntents;

  const insertConfirmed = useCallback((message: ChatMessage) => {
    let trimmed = false;
    setMessagesByConversation((prev) => {
      const list = prev.get(message.conversationId) || [];
      let next = withMessage(list, message);
      if (next === list) return prev;
      if (next.length > MAX_WINDOW) { next = next.slice(next.length - MAX_WINDOW); trimmed = true; }
      return new Map(prev).set(message.conversationId, next);
    });
    if (trimmed) setHasMoreByConversation((prev) => new Map(prev).set(message.conversationId, true));
  }, []);
  const outbox = useMessageOutbox({ sendWs, onConfirmed: insertConfirmed });
  const { enqueue: enqueuePending, onEcho: onPendingEcho, onReconnected: onOutboxReconnected } = outbox;

  const clearUnread = useCallback((conversationId: string) => {
    setUnreadByConversation((prev) => {
      if (!prev.has(conversationId)) return prev;
      const next = new Map(prev);
      next.delete(conversationId);
      return next;
    });
  }, []);

  const setLoading = useCallback((direction: 'older' | 'newer', conversationId: string, loading: boolean) => {
    (direction === 'older' ? setLoadingOlderByConversation : setLoadingNewerByConversation)((prev) => updateSet(prev, conversationId, loading));
  }, []);

  const startPage = useCallback((direction: 'older' | 'newer', conversationId: string): string | null => {
    const key = `${direction}:${conversationId}`;
    if (pageRequestsRef.current.has(key)) return null;
    const requestId = crypto.randomUUID();
    const timer = setTimeout(() => {
      if (pageRequestsRef.current.get(key)?.requestId !== requestId) return;
      pageRequestsRef.current.delete(key);
      setLoading(direction, conversationId, false);
    }, PAGE_TIMEOUT_MS);
    pageRequestsRef.current.set(key, { requestId, timer });
    setLoading(direction, conversationId, true);
    return requestId;
  }, [setLoading]);

  /** True when this page answers the current request (or comes from a
   * server too old to echo one). */
  const finishPage = useCallback((direction: 'older' | 'newer', conversationId: string, requestId: string | undefined): boolean => {
    const key = `${direction}:${conversationId}`;
    const current = pageRequestsRef.current.get(key);
    if (requestId !== undefined && current?.requestId !== requestId) return false;
    if (current) clearTimeout(current.timer);
    pageRequestsRef.current.delete(key);
    setLoading(direction, conversationId, false);
    return true;
  }, [setLoading]);

  /** A new window (open, jump) replaces whatever pages were on their way. */
  const resetPages = useCallback((conversationId: string) => {
    for (const direction of ['older', 'newer'] as const) {
      const key = `${direction}:${conversationId}`;
      const current = pageRequestsRef.current.get(key);
      if (current) clearTimeout(current.timer);
      pageRequestsRef.current.delete(key);
      setLoading(direction, conversationId, false);
    }
    setNewerCountByConversation((prev) => { if (!prev.has(conversationId)) return prev; const next = new Map(prev); next.delete(conversationId); return next; });
  }, [setLoading]);

  const loadOlderMessages = useCallback((conversationId: string) => {
    if (hasMoreByConversationRef.current.get(conversationId) === false) return;
    const oldest = messagesByConversationRef.current.get(conversationId)?.[0];
    if (!oldest) return;
    const requestId = startPage('older', conversationId);
    if (requestId) sendWs({ t: 'load-more-messages', conversationId, beforeMsgId: oldest.msgId, requestId });
  }, [sendWs, startPage]);

  const loadNewerMessages = useCallback((conversationId: string) => {
    if (hasMoreAfterRef.current.get(conversationId) !== true) return;
    const list = messagesByConversationRef.current.get(conversationId);
    const newest = list?.[list.length - 1];
    if (!newest) return;
    const requestId = startPage('newer', conversationId);
    if (requestId) sendWs({ t: 'load-messages-after', conversationId, afterMsgId: newest.msgId, requestId });
  }, [sendWs, startPage]);

  // your own message belongs at the present: sending from an old window
  // brings the conversation back to its latest page
  const returnToPresentIfBehind = useCallback((conversationId: string) => {
    if (hasMoreAfterRef.current.get(conversationId) === true) sendWs({ t: 'conversation-open', conversationId });
  }, [sendWs]);

  const [pendingJumpTarget, setPendingJumpTargetState] = useState<{ conversationId: string; msgId: number } | null>(null);
  const pendingJumpRef = useRef<{ conversationId: string; msgId: number } | null>(null);
  const clearPendingJumpTarget = useCallback(() => setPendingJumpTargetState(null), []);

  const jumpToMessage = useCallback((conversationId: string, msgId: number) => {
    const alreadyLoaded = messagesByConversationRef.current.get(conversationId)?.some((msg) => msg.msgId === msgId) ?? false;
    if (conversationId !== activeConversationIdRef.current) {
      // Same "switch conversation" behavior as openConversation (RoomProvider) —
      // move the cursor and reset this conversation's compose state — just
      // composed here instead, since jumpToMessage can target a DIFFERENT
      // conversation than the one currently open.
      setActiveConversation(conversationId);
      clearUnread(conversationId);
      setReplyingTo(null);
      setEditingMsgId(null);
    }
    setPendingJumpTargetState({ conversationId, msgId });
    if (alreadyLoaded) return;
    pendingJumpRef.current = { conversationId, msgId };
    sendWs({ t: 'load-messages-around', conversationId, msgId });
  }, [sendWs, setActiveConversation, activeConversationIdRef, clearUnread]);

  /** For the 'message-not-found' error (a search result / jump target
   * pointing at a since-deleted message) — cancels the pending jump so a
   * later, unrelated conversation-history-around doesn't get misread as
   * its answer. */
  const cancelPendingJump = useCallback(() => {
    pendingJumpRef.current = null;
    setPendingJumpTargetState(null);
  }, []);

  // only for drawing the pending copy; the server builds the real reference
  const pendingReplyRef = useCallback((conversationId: string, replyTo?: number) => {
    const original = replyTo ? messagesByConversationRef.current.get(conversationId)?.find((msg) => msg.msgId === replyTo) : undefined;
    return original ? { msgId: original.msgId, authorId: original.id, text: original.text.slice(0, 120) } : undefined;
  }, []);

  /** A batch goes through the outbox: staged, then published with its
   * message once every file is ready. */
  const queueMessageWithFiles = useCallback((conversationId: string, text: string, replyTo: number | undefined, files: { file: File; compress: boolean }[]) => {
    returnToPresentIfBehind(conversationId);
    enqueuePending(conversationId, text.trim(), pendingReplyRef(conversationId, replyTo), files);
  }, [enqueuePending, pendingReplyRef, returnToPresentIfBehind]);

  const sendChatMessage = useCallback((conversationId: string, text: string, replyTo?: number) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    returnToPresentIfBehind(conversationId);
    enqueuePending(conversationId, trimmed, pendingReplyRef(conversationId, replyTo));
  }, [enqueuePending, pendingReplyRef, returnToPresentIfBehind]);

  /** Every welcome, including after a reconnect: resends whatever was still
   * unconfirmed from before the (re)connection. */
  const onWelcome = useCallback(() => {
    onOutboxReconnected();
  }, [onOutboxReconnected]);
  const dismissMessageActionError = useCallback((msgId: number) => {
    setMessageActionErrors((prev) => { if (!prev.has(msgId)) return prev; const next = new Map(prev); next.delete(msgId); return next; });
  }, []);

  /** Resolves once the server removed it. A failure stays visible on the
   * row instead of the message silently staying put. */
  const deleteChatMessage = useCallback(async (msgId: number): Promise<void> => {
    dismissMessageActionError(msgId);
    setDeletingMsgIds((prev) => new Set(prev).add(msgId));
    try {
      await requestAction({ t: 'chat-delete', msgId });
    } catch (err) {
      setMessageActionErrors((prev) => new Map(prev).set(msgId, `Não foi possível apagar: ${err instanceof Error ? err.message : 'erro desconhecido'}`));
    } finally {
      setDeletingMsgIds((prev) => { const next = new Set(prev); next.delete(msgId); return next; });
    }
  }, [requestAction, dismissMessageActionError]);

  /** Rejects with the server's reason, so the editor can stay open with it. */
  const editChatMessage = useCallback(async (msgId: number, text: string): Promise<void> => {
    const trimmed = text.trim();
    if (!trimmed) return;
    await requestAction({ t: 'chat-edit', msgId, text: trimmed });
  }, [requestAction]);
  const reactToChatMessage = useCallback((msgId: number, emoji: ReactionEmoji) => {
    let mineOnServer = false;
    for (const list of messagesByConversationRef.current.values()) {
      const message = list.find((msg) => msg.msgId === msgId);
      if (message) { mineOnServer = !!myUserIdRef.current && !!message.reactions?.[emoji]?.includes(myUserIdRef.current); break; }
    }
    reactWithIntent(msgId, emoji, mineOnServer);
  }, [reactWithIntent, myUserIdRef]);

  const onConversationHistory = useCallback((m: Extract<ServerMessage, { t: 'conversation-history' }>) => {
    resetPages(m.conversationId);
    bumpWindow(m.conversationId);
    touchConversationCache(m.conversationId);
    setMessagesByConversation((prev) => new Map(prev).set(m.conversationId, m.messages));
    setHasMoreByConversation((prev) => new Map(prev).set(m.conversationId, m.hasMore));
    setHasMoreAfterByConversation((prev) => new Map(prev).set(m.conversationId, false));
  }, [resetPages, bumpWindow, touchConversationCache]);

  const onConversationHistoryAround = useCallback((m: Extract<ServerMessage, { t: 'conversation-history-around' }>) => {
    const pending = pendingJumpRef.current;
    if (!pending || pending.conversationId !== m.conversationId || pending.msgId !== m.msgId) return;
    pendingJumpRef.current = null;
    resetPages(m.conversationId);
    bumpWindow(m.conversationId);
    setMessagesByConversation((prev) => new Map(prev).set(m.conversationId, m.messages));
    setHasMoreByConversation((prev) => new Map(prev).set(m.conversationId, m.hasMoreBefore));
    setHasMoreAfterByConversation((prev) => new Map(prev).set(m.conversationId, m.hasMoreAfter));
  }, [resetPages, bumpWindow]);

  const onConversationHistoryMore = useCallback((m: Extract<ServerMessage, { t: 'conversation-history-more' }>) => {
    const conversationId = m.conversationId;
    if (!finishPage('older', conversationId, m.requestId)) return;
    setHasMoreByConversation((prev) => new Map(prev).set(conversationId, m.hasMore));
    if (!m.messages.length) return;
    const update = withOlderPage(messagesByConversationRef.current.get(conversationId) ?? [], m.messages);
    setMessagesByConversation((prev) => new Map(prev).set(conversationId, update.messages));
    if (update.trimmedNewest) setHasMoreAfterByConversation((prev) => new Map(prev).set(conversationId, true));
  }, [finishPage]);

  const onConversationHistoryNewer = useCallback((m: Extract<ServerMessage, { t: 'conversation-history-newer' }>) => {
    const conversationId = m.conversationId;
    if (!finishPage('newer', conversationId, m.requestId)) return;
    const update = withNewerMessages(messagesByConversationRef.current.get(conversationId) ?? [], m.messages);
    setMessagesByConversation((prev) => new Map(prev).set(conversationId, update.messages));
    setHasMoreAfterByConversation((prev) => new Map(prev).set(conversationId, m.hasMoreAfter));
    if (update.trimmedOldest) setHasMoreByConversation((prev) => new Map(prev).set(conversationId, true));
    // caught up with the present: whatever was counted is now in the list
    if (!m.hasMoreAfter) setNewerCountByConversation((prev) => { if (!prev.has(conversationId)) return prev; const next = new Map(prev); next.delete(conversationId); return next; });
  }, [finishPage]);

  const onChat = useCallback((m: Extract<ServerMessage, { t: 'chat' }>) => {
    const conversationId = m.message.conversationId;
    onPendingEcho(m.message);
    // a repeated delivery (or one that lost the race to its own send result)
    // must not notify or count as unread twice
    if (messagesByConversationRef.current.get(conversationId)?.some((msg) => msg.msgId === m.message.msgId)) return;
    if (hasMoreAfterRef.current.get(conversationId) === true) {
      setNewerCountByConversation((prev) => new Map(prev).set(conversationId, (prev.get(conversationId) ?? 0) + 1));
    } else {
      markArrival(m.message.clientMessageId ? `c:${m.message.clientMessageId}` : String(m.message.msgId));
      insertConfirmed(m.message);
    }
    // your own message is never unread — it can land in a conversation you
    // left (an upload finishing after a switch, or another tab/device)
    if (conversationId !== activeConversationIdRef.current && m.message.id !== myUserIdRef.current) {
      setUnreadByConversation((prev) => new Map(prev).set(conversationId, (prev.get(conversationId) || 0) + 1));
    }
    // The message itself is proof they stopped typing — don't wait for
    // their typing:false (or the local expiry timer) to catch up.
    if (m.message.id) clearTypingEntry(conversationId, m.message.id);
    const amLookingAtIt = document.hasFocus() && activeViewRef.current === 'chat' && conversationId === activeConversationIdRef.current;
    if (m.message.id !== myUserIdRef.current && !amLookingAtIt) {
      playSound('newMessage');
      notifyIncomingChatMessage({
        conversationId,
        conversationName: displayNameForConversation(conversationsRef.current.find((c) => c.id === conversationId), myUserIdRef.current, allUsersRef.current),
        senderId: m.message.id,
        senderName: (m.message.id ? allUsersRef.current.get(m.message.id)?.displayName : undefined) ?? m.message.name,
        text: messagePreviewText(m.message),
        mentioned: mentionsUsername(m.message.text, myUsernameRef.current),
      });
    }
  }, [activeConversationIdRef, clearTypingEntry, activeViewRef, myUserIdRef, conversationsRef, allUsersRef, myUsernameRef, onPendingEcho, insertConfirmed]);

  const onChatDeleted = useCallback((m: Extract<ServerMessage, { t: 'chat-deleted' }>) => {
    setMessagesByConversation((prev) => {
      const existing = prev.get(m.conversationId);
      if (!existing) return prev;
      return new Map(prev).set(m.conversationId, existing.filter((msg) => msg.msgId !== m.msgId));
    });
  }, []);

  const onChatEdited = useCallback((m: Extract<ServerMessage, { t: 'chat-edited' }>) => {
    const conversationId = m.message.conversationId;
    setMessagesByConversation((prev) => {
      const existing = prev.get(conversationId);
      if (!existing) return prev;
      return new Map(prev).set(conversationId, existing.map((msg) => (msg.msgId === m.message.msgId ? m.message : msg)));
    });
  }, []);

  /** A card's state changed on the server. The same invitation only ever
   * sits in one DM, but the client doesn't track which — patch by id across
   * every cached conversation, and return the same Map when nothing matched. */
  const onInvitationUpdated = useCallback((m: Extract<ServerMessage, { t: 'invitation-updated' }>) => {
    setMessagesByConversation((prev) => {
      let next: Map<string, ChatMessage[]> | null = null;
      for (const [conversationId, list] of prev) {
        if (!list.some((msg) => msg.invitation?.id === m.invitation.id)) continue;
        next ??= new Map(prev);
        next.set(conversationId, list.map((msg) => (msg.invitation?.id === m.invitation.id ? { ...msg, invitation: m.invitation } : msg)));
      }
      return next ?? prev;
    });
  }, []);

  const onChatAttachmentAdded = useCallback((m: Extract<ServerMessage, { t: 'chat-attachment-added' }>) => {
    setMessagesByConversation((prev) => {
      const existing = prev.get(m.conversationId);
      if (!existing) return prev;
      return new Map(prev).set(m.conversationId, existing.map((msg) => (
        msg.msgId === m.msgId ? { ...msg, attachments: [...(msg.attachments || []), m.attachment] } : msg
      )));
    });
  }, []);

  const onChatReactionUpdated = useCallback((m: Extract<ServerMessage, { t: 'chat-reaction-updated' }>) => {
    setMessagesByConversation((prev) => {
      const existing = prev.get(m.conversationId);
      if (!existing) return prev;
      const next = existing.map((msg) => {
        if (msg.msgId !== m.msgId) return msg;
        const reactions = { ...msg.reactions };
        if (m.userIds.length) reactions[m.emoji] = m.userIds; else delete reactions[m.emoji];
        return { ...msg, reactions };
      });
      return new Map(prev).set(m.conversationId, next);
    });
  }, []);

  /** Drops cached messages/unread for a deleted conversation — the
   * list-membership half of this same event is handled by
   * useConversationsList's own onConversationDeleted. */
  const onConversationDeleted = useCallback((m: Extract<ServerMessage, { t: 'conversation-deleted' }>) => {
    setMessagesByConversation((prev) => {
      if (!prev.has(m.conversationId)) return prev;
      const next = new Map(prev);
      next.delete(m.conversationId);
      return next;
    });
    clearUnread(m.conversationId);
  }, [clearUnread]);

  /** Another of this user's own sessions/tabs opened this conversation (or
   * this same tab did, redundantly) — mirrors that read state here so the
   * unread badge doesn't linger on a tab that wasn't the one used to read
   * it. */
  const onConversationRead = useCallback((m: Extract<ServerMessage, { t: 'conversation-read' }>) => {
    clearUnread(m.conversationId);
  }, [clearUnread]);

  return {
    messagesByConversation, hasMoreByConversation, hasMoreAfterByConversation, loadingOlderByConversation, unreadByConversation,
    clearUnread, loadOlderMessages, pendingJumpTarget, clearPendingJumpTarget, cancelPendingJump, jumpToMessage,
    sendChatMessage, deleteChatMessage, editChatMessage, reactToChatMessage,
    onWelcome, onChatSendResult: outbox.onChatSendResult, queueMessageWithFiles,
    onChatActionResult: actionRequests.onChatActionResult,
    deletingMsgIds, messageActionErrors, dismissMessageActionError,
    pendingReactions: reactionIntents.pendingReactions,
    pendingByConversation: outbox.pendingByConversation,
    retryPendingMessage: outbox.retry, discardPendingMessage: outbox.discard,
    replyingTo, setReplyingTo, editingMsgId, setEditingMsgId,
    reactionParticipantsTarget, openReactionParticipants, closeReactionParticipants,
    onConversationHistory, onConversationHistoryAround, onConversationHistoryMore, onConversationHistoryNewer,
    loadNewerMessages, loadingNewerByConversation, newerCountByConversation, windowGenerationByConversation,
    onChat, onChatDeleted, onChatEdited, onInvitationUpdated, onChatAttachmentAdded, onChatReactionUpdated, onConversationDeleted, onConversationRead,
  };
}

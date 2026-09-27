import { useCallback, useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import { playSound } from '@/shared/sounds';
import { notifyIncomingChatMessage } from '@/shared/notifications';
import { messagePreviewText } from '@/features/chat/messagePreview';
import { mentionsUsername } from '@/shared/lib/mentions';
import { useMessageOutbox } from './useMessageOutbox';
import { useMessageActionRequests } from './useMessageActionRequests';
import { useReactionIntents } from './useReactionIntents';
import type { ChatMessage, ClientMessage, Conversation, PublicUser, ReactionEmoji, ServerMessage } from '@/shared/types/protocol';

const CHAT_CLIENT_LIMIT = 300;
// correlated, idempotent chat sends (see useMessageOutbox)
const CORRELATED_SEND_PROTOCOL = 3;
// edits and deletes answered with chat-action-result
const CORRELATED_ACTIONS_PROTOCOL = 4;
// reactions as a desired state instead of a toggle
const REACTION_INTENTS_PROTOCOL = 5;

/** Adds `message` once, in msgId order — a send's result and its broadcast
 * both deliver it, in either order, and it may land after newer messages. */
function withMessage(list: ChatMessage[], message: ChatMessage): ChatMessage[] {
  if (list.some((existing) => existing.msgId === message.msgId)) return list;
  let index = list.length;
  while (index > 0 && list[index - 1]!.msgId > message.msgId) index--;
  const next = [...list.slice(0, index), message, ...list.slice(index)];
  return next.length > CHAT_CLIENT_LIMIT ? next.slice(next.length - CHAT_CLIENT_LIMIT) : next;
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
  const [loadingOlderByConversation, setLoadingOlderByConversation] = useState<Set<string>>(new Set());
  const loadingOlderRef = useRef<Set<string>>(new Set());
  const [unreadByConversation, setUnreadByConversation] = useState<Map<string, number>>(new Map());
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [editingMsgId, setEditingMsgId] = useState<number | null>(null);
  const correlatedSendRef = useRef(false);
  const correlatedActionsRef = useRef(false);
  const reactionIntentsRef = useRef(false);
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
    setMessagesByConversation((prev) => {
      const list = prev.get(message.conversationId) || [];
      const next = withMessage(list, message);
      return next === list ? prev : new Map(prev).set(message.conversationId, next);
    });
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

  const loadOlderMessages = useCallback((conversationId: string) => {
    if (loadingOlderRef.current.has(conversationId)) return;
    if (hasMoreByConversationRef.current.get(conversationId) === false) return;
    const oldest = messagesByConversationRef.current.get(conversationId)?.[0];
    if (!oldest) return;
    loadingOlderRef.current.add(conversationId);
    setLoadingOlderByConversation((prev) => new Set(prev).add(conversationId));
    sendWs({ t: 'load-more-messages', conversationId, beforeMsgId: oldest.msgId });
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

  /** A batch goes through the outbox (staged, then published with its
   * message). False on a server too old for that — the caller falls back
   * to the legacy upload. */
  const queueMessageWithFiles = useCallback((conversationId: string, text: string, replyTo: number | undefined, files: { file: File; compress: boolean }[]) => {
    if (!correlatedSendRef.current) return false;
    enqueuePending(conversationId, text.trim(), pendingReplyRef(conversationId, replyTo), files);
    return true;
  }, [enqueuePending, pendingReplyRef]);

  const sendChatMessage = useCallback((conversationId: string, text: string, replyTo?: number) => {
    const trimmed = text.trim();
    if (!trimmed) return false;
    if (correlatedSendRef.current) {
      enqueuePending(conversationId, trimmed, pendingReplyRef(conversationId, replyTo));
      return true;
    }
    return sendWs({ t: 'chat', conversationId, text: trimmed, ...(replyTo ? { replyTo } : {}) });
  }, [sendWs, enqueuePending, pendingReplyRef]);

  /** Every welcome, including after a reconnect: learns what this server
   * supports and resends whatever was still unconfirmed. */
  const onWelcome = useCallback((protocolVersion: number | undefined) => {
    correlatedSendRef.current = (protocolVersion ?? 0) >= CORRELATED_SEND_PROTOCOL;
    correlatedActionsRef.current = (protocolVersion ?? 0) >= CORRELATED_ACTIONS_PROTOCOL;
    reactionIntentsRef.current = (protocolVersion ?? 0) >= REACTION_INTENTS_PROTOCOL;
    onOutboxReconnected();
  }, [onOutboxReconnected]);
  const dismissMessageActionError = useCallback((msgId: number) => {
    setMessageActionErrors((prev) => { if (!prev.has(msgId)) return prev; const next = new Map(prev); next.delete(msgId); return next; });
  }, []);

  /** Resolves once the server removed it (older servers: once sent). A
   * failure stays visible on the row instead of the message silently
   * staying put. */
  const deleteChatMessage = useCallback(async (msgId: number): Promise<void> => {
    if (!correlatedActionsRef.current) { sendWs({ t: 'chat-delete', msgId }); return; }
    dismissMessageActionError(msgId);
    setDeletingMsgIds((prev) => new Set(prev).add(msgId));
    try {
      await requestAction({ t: 'chat-delete', msgId });
    } catch (err) {
      setMessageActionErrors((prev) => new Map(prev).set(msgId, `Não foi possível apagar: ${err instanceof Error ? err.message : 'erro desconhecido'}`));
    } finally {
      setDeletingMsgIds((prev) => { const next = new Set(prev); next.delete(msgId); return next; });
    }
  }, [sendWs, requestAction, dismissMessageActionError]);

  /** Rejects with the server's reason, so the editor can stay open with it. */
  const editChatMessage = useCallback(async (msgId: number, text: string): Promise<void> => {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (!correlatedActionsRef.current) { sendWs({ t: 'chat-edit', msgId, text: trimmed }); return; }
    await requestAction({ t: 'chat-edit', msgId, text: trimmed });
  }, [sendWs, requestAction]);
  const reactToChatMessage = useCallback((msgId: number, emoji: ReactionEmoji) => {
    if (!reactionIntentsRef.current) { sendWs({ t: 'chat-react', msgId, emoji }); return; }
    let mineOnServer = false;
    for (const list of messagesByConversationRef.current.values()) {
      const message = list.find((msg) => msg.msgId === msgId);
      if (message) { mineOnServer = !!myUserIdRef.current && !!message.reactions?.[emoji]?.includes(myUserIdRef.current); break; }
    }
    reactWithIntent(msgId, emoji, mineOnServer);
  }, [sendWs, reactWithIntent, myUserIdRef]);

  const onConversationHistory = useCallback((m: Extract<ServerMessage, { t: 'conversation-history' }>) => {
    setMessagesByConversation((prev) => new Map(prev).set(m.conversationId, m.messages));
    setHasMoreByConversation((prev) => new Map(prev).set(m.conversationId, m.hasMore));
    setHasMoreAfterByConversation((prev) => new Map(prev).set(m.conversationId, false));
  }, []);

  const onConversationHistoryAround = useCallback((m: Extract<ServerMessage, { t: 'conversation-history-around' }>) => {
    const pending = pendingJumpRef.current;
    if (!pending || pending.conversationId !== m.conversationId || pending.msgId !== m.msgId) return;
    pendingJumpRef.current = null;
    setMessagesByConversation((prev) => new Map(prev).set(m.conversationId, m.messages));
    setHasMoreByConversation((prev) => new Map(prev).set(m.conversationId, m.hasMoreBefore));
    setHasMoreAfterByConversation((prev) => new Map(prev).set(m.conversationId, m.hasMoreAfter));
  }, []);

  const onConversationHistoryMore = useCallback((m: Extract<ServerMessage, { t: 'conversation-history-more' }>) => {
    const conversationId = m.conversationId;
    loadingOlderRef.current.delete(conversationId);
    setLoadingOlderByConversation((prev) => {
      if (!prev.has(conversationId)) return prev;
      const next = new Set(prev);
      next.delete(conversationId);
      return next;
    });
    setHasMoreByConversation((prev) => new Map(prev).set(conversationId, m.hasMore));
    if (m.messages.length > 0) {
      setMessagesByConversation((prev) => {
        const existing = prev.get(conversationId) || [];
        const existingIds = new Set(existing.map((msg) => msg.msgId));
        const older = m.messages.filter((msg) => !existingIds.has(msg.msgId));
        return new Map(prev).set(conversationId, [...older, ...existing]);
      });
    }
  }, []);

  const onChat = useCallback((m: Extract<ServerMessage, { t: 'chat' }>) => {
    const conversationId = m.message.conversationId;
    onPendingEcho(m.message);
    // a repeated delivery (or one that lost the race to its own send result)
    // must not notify or count as unread twice
    if (messagesByConversationRef.current.get(conversationId)?.some((msg) => msg.msgId === m.message.msgId)) return;
    insertConfirmed(m.message);
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
    onConversationHistory, onConversationHistoryAround, onConversationHistoryMore,
    onChat, onChatDeleted, onChatEdited, onInvitationUpdated, onChatAttachmentAdded, onChatReactionUpdated, onConversationDeleted, onConversationRead,
  };
}

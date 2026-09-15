import { useCallback, useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import { playSound } from '../../shared/sounds';
import { notifyIncomingChatMessage } from '../../shared/notifications';
import { mentionsUsername } from '../../shared/lib/mentions';
import type { ChatMessage, ClientMessage, Conversation, PublicUser, ReactionEmoji, ServerMessage } from '../../types/protocol';

const CHAT_CLIENT_LIMIT = 300;

function displayNameForConversation(conversation: Conversation | undefined, meUserId: string | null, users: Map<string, PublicUser>): string {
  if (!conversation) return 'Conversa';
  if (conversation.type === 'group') return conversation.title || 'Grupo';
  const otherId = conversation.memberIds.find((id) => id !== meUserId) ?? conversation.memberIds[0];
  const other = otherId ? users.get(otherId) : undefined;
  return other?.displayName || other?.username || 'Conversa direta';
}

interface ChatMessagesDeps {
  sendWs: (msg: ClientMessage) => void;
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

  const sendChatMessage = useCallback((conversationId: string, text: string, replyTo?: number) => {
    const trimmed = text.trim();
    if (trimmed) sendWs({ t: 'chat', conversationId, text: trimmed, ...(replyTo ? { replyTo } : {}) });
  }, [sendWs]);
  const deleteChatMessage = useCallback((msgId: number) => sendWs({ t: 'chat-delete', msgId }), [sendWs]);
  const editChatMessage = useCallback((msgId: number, text: string) => {
    const trimmed = text.trim();
    if (trimmed) sendWs({ t: 'chat-edit', msgId, text: trimmed });
  }, [sendWs]);
  const reactToChatMessage = useCallback((msgId: number, emoji: ReactionEmoji) => sendWs({ t: 'chat-react', msgId, emoji }), [sendWs]);

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
    setMessagesByConversation((prev) => {
      const existing = prev.get(conversationId) || [];
      const next = [...existing, m.message];
      return new Map(prev).set(conversationId, next.length > CHAT_CLIENT_LIMIT ? next.slice(next.length - CHAT_CLIENT_LIMIT) : next);
    });
    if (conversationId !== activeConversationIdRef.current) {
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
        text: m.message.text,
        mentioned: mentionsUsername(m.message.text, myUsernameRef.current),
      });
    }
  }, [activeConversationIdRef, clearTypingEntry, activeViewRef, myUserIdRef, conversationsRef, allUsersRef, myUsernameRef]);

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

  return {
    messagesByConversation, hasMoreByConversation, hasMoreAfterByConversation, loadingOlderByConversation, unreadByConversation,
    clearUnread, loadOlderMessages, pendingJumpTarget, clearPendingJumpTarget, cancelPendingJump, jumpToMessage,
    sendChatMessage, deleteChatMessage, editChatMessage, reactToChatMessage,
    replyingTo, setReplyingTo, editingMsgId, setEditingMsgId,
    onConversationHistory, onConversationHistoryAround, onConversationHistoryMore,
    onChat, onChatDeleted, onChatEdited, onChatAttachmentAdded, onChatReactionUpdated, onConversationDeleted,
  };
}

import { useCallback, useRef, useState } from 'react';
import type { ClientMessage, Conversation, ServerMessage } from '@/shared/types/protocol';

/** Mirrors listForUser's own ORDER BY (server/src/modules/conversations.ts)
 * — pinned first (most recently pinned first among those), then everyone
 * else by recency. Used both for the optimistic pin re-sort and for
 * re-sorting after any incremental update that could change ordering.
 * Deliberately `lastMessageAt ?? createdAt`, not `updatedAt` — a rename or
 * a message edit/delete must not resort the sidebar, only a genuinely NEW
 * message does (server-side: schema.ts#conversations, touchConversation). */
function sortConversations(list: Conversation[]): Conversation[] {
  return [...list].sort((a, b) => (
    Number(!!b.pinnedAt) - Number(!!a.pinnedAt)
    || (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0)
    || (b.lastMessageAt ?? b.createdAt) - (a.lastMessageAt ?? a.createdAt)
  ));
}

/** The conversation list/sidebar + which one is currently open. Message
 * content itself (messagesByConversation, unread counts, reply/edit draft
 * state) lives in useChatMessages — this hook only owns the list of
 * conversations and the "which one is active" cursor.
 *
 * `setActiveConversation` is intentionally BARE (just moves the cursor) —
 * the original single-component version also cleared unread/reply/editing
 * state on every switch, but that state now lives in useChatMessages, so
 * RoomProvider composes the full "open/close a conversation" behavior from
 * both hooks' primitives instead of either hook reaching into the other's
 * state. */
export function useConversationsList(sendWs: (msg: ClientMessage) => void) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const conversationsRef = useRef<Conversation[]>([]);
  const [activeConversationId, setActiveConversationIdState] = useState<string | null>(null);
  const activeConversationIdRef = useRef<string | null>(null);

  const setInitial = useCallback((initial: Conversation[]) => {
    setConversations(initial);
    conversationsRef.current = initial;
  }, []);

  const setActiveConversation = useCallback((conversationId: string) => {
    activeConversationIdRef.current = conversationId;
    setActiveConversationIdState(conversationId);
  }, []);

  const clearActiveConversation = useCallback(() => {
    activeConversationIdRef.current = null;
    setActiveConversationIdState(null);
  }, []);

  const openDirect = useCallback((userId: string) => sendWs({ t: 'direct-open', userId }), [sendWs]);

  /** List-membership + cursor half of "close a conversation" — optimistic,
   * same shape as 'conversation-deleted' minus the parts that only make
   * sense for an actual delete. The caller also clears unread (owned by
   * useChatMessages) and sends the close itself. */
  const removeConversation = useCallback((conversationId: string) => {
    setConversations((prev) => prev.filter((c) => c.id !== conversationId));
    conversationsRef.current = conversationsRef.current.filter((c) => c.id !== conversationId);
    if (conversationId === activeConversationIdRef.current) clearActiveConversation();
  }, [clearActiveConversation]);

  const pinConversation = useCallback((conversationId: string, pinned: boolean) => {
    // Optimistic re-sort so the row jumps immediately instead of waiting on
    // the round-trip; the real 'conversation-pinned' broadcast (below)
    // settles it — including for this same tab, since it's a no-op once
    // the optimistic value already matches.
    const next = sortConversations(conversationsRef.current.map((c) => (c.id === conversationId ? { ...c, pinnedAt: pinned ? Date.now() : null } : c)));
    conversationsRef.current = next;
    setConversations(next);
    sendWs({ t: 'conversation-pin', conversationId, pinned });
  }, [sendWs]);

  const createGroup = useCallback((title: string, memberIds: string[]) => sendWs({ t: 'group-create', title, memberIds }), [sendWs]);
  const deleteGroup = useCallback((conversationId: string) => sendWs({ t: 'group-delete', conversationId }), [sendWs]);
  const updateGroupTitle = useCallback((conversationId: string, title: string) => sendWs({ t: 'group-update', conversationId, title }), [sendWs]);
  const updateGroupAvatar = useCallback((conversationId: string, avatar: string) => sendWs({ t: 'group-update', conversationId, avatar }), [sendWs]);
  const addGroupMembers = useCallback((conversationId: string, memberIds: string[]) => sendWs({ t: 'group-members-add', conversationId, memberIds }), [sendWs]);
  const removeGroupMember = useCallback((conversationId: string, userId: string) => sendWs({ t: 'group-members-remove', conversationId, userId }), [sendWs]);

  /** A conversation now belongs on this client's sidebar for the first
   * time (new group, or just added to an existing one) — upsert by id
   * (same merge onConversationOpened does), but never switches the active
   * conversation; that's what 'conversation-opened' is for. */
  const onConversationCreated = useCallback((m: Extract<ServerMessage, { t: 'conversation-created' }>) => {
    const idx = conversationsRef.current.findIndex((c) => c.id === m.conversation.id);
    const next = idx === -1 ? [m.conversation, ...conversationsRef.current] : conversationsRef.current.map((c) => (c.id === m.conversation.id ? m.conversation : c));
    conversationsRef.current = next;
    setConversations(next);
  }, []);

  /** A conversation this client already has changed (rename, avatar, or
   * message activity bumping lastMessageAt/updatedAt) — replace by id and
   * re-sort, since activity/pin ordering could have changed. */
  const onConversationUpdated = useCallback((m: Extract<ServerMessage, { t: 'conversation-updated' }>) => {
    if (!conversationsRef.current.some((c) => c.id === m.conversation.id)) return;
    const next = sortConversations(conversationsRef.current.map((c) => (c.id === m.conversation.id ? m.conversation : c)));
    conversationsRef.current = next;
    setConversations(next);
  }, []);

  const onConversationMemberAdded = useCallback((m: Extract<ServerMessage, { t: 'conversation-member-added' }>) => {
    setConversations((prev) => {
      const next = prev.map((c) => (c.id === m.conversationId && !c.memberIds.includes(m.userId) ? { ...c, memberIds: [...c.memberIds, m.userId] } : c));
      conversationsRef.current = next;
      return next;
    });
  }, []);

  const onConversationMemberRemoved = useCallback((m: Extract<ServerMessage, { t: 'conversation-member-removed' }>) => {
    setConversations((prev) => {
      const next = prev.map((c) => (c.id === m.conversationId ? { ...c, memberIds: c.memberIds.filter((id) => id !== m.userId) } : c));
      conversationsRef.current = next;
      return next;
    });
  }, []);

  /** Syncs pin state pushed from ANOTHER of this user's own sessions/tabs —
   * this tab's own pinConversation() already applied it optimistically, so
   * this is a no-op for the tab that acted and a sync for the others. */
  const onConversationPinned = useCallback((m: Extract<ServerMessage, { t: 'conversation-pinned' }>) => {
    if (!conversationsRef.current.some((c) => c.id === m.conversationId)) return;
    const next = sortConversations(conversationsRef.current.map((c) => (c.id === m.conversationId ? { ...c, pinnedAt: m.pinnedAt } : c)));
    conversationsRef.current = next;
    setConversations(next);
  }, []);

  /** `openConversationFull` is RoomProvider's composed openConversation
   * (cursor + unread/reply/editing clear + sendWs) — passed in at call
   * time since this handler needs the FULL behavior, not just the cursor
   * move this hook owns on its own. */
  const onConversationOpened = useCallback((m: Extract<ServerMessage, { t: 'conversation-opened' }>, openConversationFull: (conversationId: string) => void) => {
    // An empty (or closed) direct conversation never shows up in
    // conversation-list — the server sends its summary straight to the
    // opener instead so it can still be rendered/typed into for this
    // session; it becomes "real" history for everyone once a message
    // is actually sent (touchConversation broadcasts the list then).
    const idx = conversationsRef.current.findIndex((c) => c.id === m.conversation.id);
    const nextConversations = idx === -1
      ? [m.conversation, ...conversationsRef.current]
      : conversationsRef.current.map((c) => (c.id === m.conversation.id ? m.conversation : c));
    conversationsRef.current = nextConversations;
    setConversations(nextConversations);
    openConversationFull(m.conversationId);
  }, []);

  /** Only the list-membership half of "a conversation got deleted" — the
   * caller (RoomProvider) also tells useChatMessages to drop its cached
   * messages/unread count, and useCallLifecycle to leave the call if it was
   * the active one, since none of that state lives here. */
  const onConversationDeleted = useCallback((m: Extract<ServerMessage, { t: 'conversation-deleted' }>) => {
    setConversations((prev) => prev.filter((c) => c.id !== m.conversationId));
    conversationsRef.current = conversationsRef.current.filter((c) => c.id !== m.conversationId);
    if (m.conversationId === activeConversationIdRef.current) clearActiveConversation();
  }, [clearActiveConversation]);

  return {
    conversations, conversationsRef, activeConversationId, activeConversationIdRef,
    setInitial, setActiveConversation, clearActiveConversation, removeConversation,
    openDirect, pinConversation,
    createGroup, deleteGroup, updateGroupTitle, updateGroupAvatar, addGroupMembers, removeGroupMember,
    onConversationCreated, onConversationUpdated, onConversationMemberAdded, onConversationMemberRemoved,
    onConversationPinned, onConversationOpened, onConversationDeleted,
  };
}

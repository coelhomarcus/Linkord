import { useCallback, useEffect, useRef, useState, useReducer } from 'react';
import type { ReactNode } from 'react';
import { Room } from 'livekit-client';
import type { Socket } from 'socket.io-client';
import { RoomContext } from '@/state/RoomContext';
import type { AudioHandle, TileDomHandle } from '@/state/RoomContext';
import { roomReducer, initialRoomState } from '@/state/roomReducer';
import { useAuth } from '@/state/AuthContext';
import { saveIdentity } from '@/shared/lib/identitySession';
import { useSocketConnection } from '@/state/hooks/useSocketConnection';
import { useScreenShare } from '@/features/calls/useScreenShare';
import { useCamera } from '@/features/calls/useCamera';
import { useMicrophone } from '@/features/calls/useMicrophone';
import { useTileMenu } from '@/features/calls/useTileMenu';
import { useConversationsList } from '@/features/conversations/useConversationsList';
import { useChatMessages } from '@/features/chat/useChatMessages';
import { useTypingIndicator } from '@/state/hooks/useTypingIndicator';
import { useMessageReactions } from '@/features/calls/useMessageReactions';
import { useMessageSearch } from '@/features/chat/useMessageSearch';
import { useAttachmentsUpload } from '@/features/chat/useAttachmentsUpload';
import { usePresence } from '@/state/hooks/usePresence';
import { useCallLifecycle } from '@/features/calls/useCallLifecycle';
import { useRoomSettings } from '@/features/settings/useRoomSettings';
import { useProfileUpdate } from '@/features/profile/useProfileUpdate';
import { preloadSounds } from '@/shared/sounds';
import { setNotificationClickHandler } from '@/shared/notifications';
import type { ClientMessage, ServerMessage } from '@/shared/types/protocol';

export { PartialAttachmentError } from '@/features/chat/useAttachmentsUpload';

export function RoomProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(roomReducer, initialRoomState);
  const { refresh: refreshAuth } = useAuth();

  const myIdRef = useRef<string | null>(null);
  const myUserIdRef = useRef<string | null>(null);
  const myUsernameRef = useRef<string | null>(null);
  const tokenRef = useRef<string | null>(null);
  const tileDomRegistry = useRef<Map<string, TileDomHandle>>(new Map());
  const audioRegistry = useRef<Map<string, AudioHandle>>(new Map());
  // owned here (not inside useSocketConnection) because sendWs needs to
  // read it and is constructed before that hook runs — nearly every domain
  // hook below needs sendWs too.
  const socketRef = useRef<Socket | null>(null);
  const intentionalCloseRef = useRef(false);

  const [livekitRoom] = useState(() => new Room({
    adaptiveStream: true,
    dynacast: true,
  }));

  const sendWs = useCallback((msg: ClientMessage) => {
    if (socketRef.current?.connected) socketRef.current.emit(msg.t, msg);
  }, []);

  const activeViewRef = useRef<'chat' | 'call'>('chat');
  const notifyActiveView = useCallback((view: 'chat' | 'call') => { activeViewRef.current = view; }, []);
  const requestChatViewRef = useRef<(() => void) | null>(null);
  const registerRequestChatView = useCallback((fn: () => void) => { requestChatViewRef.current = fn; }, []);
  const requestChatView = useCallback(() => { requestChatViewRef.current?.(); }, []);

  const [moderationError, setModerationError] = useState<string | null>(null);
  // 'forbidden'/'conflict'/'not_found' over the socket are, today, only
  // ever group-action denials (conversations.ts) — rename/delete/members/
  // transfer/leave. If another domain starts using these same codes over
  // the socket later, this needs to get more specific (e.g. carry which
  // action it was about) instead of assuming "group action" like it does now.
  const [groupActionError, setGroupActionError] = useState<string | null>(null);
  // bumped whenever the server says friends/requests/blocks changed — the
  // friends feature refetches its own lists off this, so social state never
  // has to live inside the room reducer
  const [socialRevision, setSocialRevision] = useState(0);

  // Domain hooks — each owns one slice of what used to all live directly in
  // this component (see the module comment in each hooks/use*.ts file for
  // why it's split this way). Construction order matters in a couple of
  // spots: presence before chatMessages (chatMessages reads its allUsersRef),
  // and the camera/screen-share/mic hooks before useCallLifecycle (it
  // composes their leave/mute functions) and before useRoomSettings (it
  // needs useMicrophone's setNoiseSuppressionEnabled).
  const conversationsList = useConversationsList(sendWs);
  const presence = usePresence();
  const typingIndicator = useTypingIndicator(sendWs, myUserIdRef);
  const chatMessages = useChatMessages({
    sendWs,
    activeConversationIdRef: conversationsList.activeConversationIdRef,
    setActiveConversation: conversationsList.setActiveConversation,
    conversationsRef: conversationsList.conversationsRef,
    allUsersRef: presence.allUsersRef,
    myUserIdRef,
    myUsernameRef,
    activeViewRef,
    clearTypingEntry: typingIndicator.clearTypingEntry,
  });
  const messageReactions = useMessageReactions(sendWs, myIdRef);
  const messageSearch = useMessageSearch(sendWs);
  const attachmentsUpload = useAttachmentsUpload();

  const { startSharing, stopSharing } = useScreenShare(livekitRoom, dispatch);
  const { startCamera, stopCamera } = useCamera(livekitRoom, dispatch);
  const { activateMic, toggleMicMuted, setMicMuted, leaveMic, setNoiseSuppressionEnabled: applyNoiseSuppression } = useMicrophone(livekitRoom, dispatch);

  const roomSettings = useRoomSettings(applyNoiseSuppression);

  const callLifecycle = useCallLifecycle({
    livekitRoom, dispatch, sendWs, stopCamera, stopSharing, activateMic, setMicMuted, leaveMic,
    cameraOn: state.me.cameraOn, sharing: state.me.sharing,
  });

  const profileUpdate = useProfileUpdate({
    dispatch, sendWs, myUserIdRef, setAllUsers: presence.setAllUsers,
    name: state.me.name, avatar: state.me.avatar, avatarPoster: state.me.avatarPoster, avatarColor: state.me.avatarColor,
    banner: state.me.banner, bannerPoster: state.me.bannerPoster, bio: state.me.bio,
    displayName: state.me.displayName, profileLinks: state.me.profileLinks,
  });

  const tileMenu = useTileMenu();

  /** The FULL "open a conversation" behavior — cursor move (conversationsList)
   * plus resetting this conversation's unread/reply/editing state
   * (chatMessages) plus telling the server. Composed here, not inside
   * either hook, because it's the one operation that genuinely spans both
   * of their state. */
  const openConversation = useCallback((conversationId: string) => {
    conversationsList.setActiveConversation(conversationId);
    chatMessages.clearUnread(conversationId);
    chatMessages.setReplyingTo(null);
    chatMessages.setEditingMsgId(null);
    sendWs({ t: 'conversation-open', conversationId });
  }, [conversationsList.setActiveConversation, chatMessages.clearUnread, chatMessages.setReplyingTo, chatMessages.setEditingMsgId, sendWs]);

  const closeConversation = useCallback((conversationId: string) => {
    conversationsList.removeConversation(conversationId);
    chatMessages.clearUnread(conversationId);
    sendWs({ t: 'conversation-close', conversationId });
  }, [conversationsList.removeConversation, chatMessages.clearUnread, sendWs]);

  const deleteUserAccount = useCallback((userId: string) => sendWs({ t: 'user-delete', userId }), [sendWs]);

  const disconnectIntentionally = useCallback(() => {
    intentionalCloseRef.current = true;
    try { socketRef.current?.disconnect(); } catch { /* socket ja morrendo */ }
  }, []);

  const handleServerMessage = useCallback((m: ServerMessage) => {
    switch (m.t) {
      case 'welcome': {
        myIdRef.current = m.id;
        myUserIdRef.current = m.userId;
        myUsernameRef.current = m.name;
        tokenRef.current = m.token;
        saveIdentity(m.id, m.token);
        dispatch({
          type: 'WELCOME',
          id: m.id,
          userId: m.userId,
          name: m.name,
          displayName: m.displayName,
          avatar: m.avatar,
          avatarPoster: m.avatarPoster,
          avatarColor: m.avatarColor,
          banner: m.banner,
          bannerPoster: m.bannerPoster,
          bio: m.bio,
          profileLinks: m.profileLinks,
          role: m.role,
          participants: m.participants,
        });
        conversationsList.setInitial(m.conversations ?? []);
        presence.setInitial(m.knownUsers, m.onlineUserIds);
        attachmentsUpload.setStorageUsage(m.storageUsage);
        {
          const firstConversation = (m.conversations ?? [])[0];
          if (firstConversation) openConversation(firstConversation.id);
        }
        break;
      }
      case 'call-token':
        callLifecycle.onCallToken(m);
        break;
      case 'participant-joined':
        dispatch({ type: 'PARTICIPANT_JOINED', participant: m.participant });
        presence.onParticipantJoined(m);
        break;
      case 'participant-updated':
        dispatch({ type: 'PARTICIPANT_UPDATED', participant: m.participant });
        presence.onParticipantUpdated(m);
        break;
      case 'participant-left':
        dispatch({ type: 'PARTICIPANT_LEFT', id: m.id });
        break;
      case 'reaction':
        messageReactions.onReaction(m);
        break;
      case 'conversation-opened':
        conversationsList.onConversationOpened(m, openConversation);
        break;
      case 'conversation-created':
        conversationsList.onConversationCreated(m);
        break;
      case 'conversation-updated':
        conversationsList.onConversationUpdated(m);
        break;
      case 'conversation-member-added':
        conversationsList.onConversationMemberAdded(m);
        break;
      case 'conversation-member-removed':
        conversationsList.onConversationMemberRemoved(m);
        break;
      case 'conversation-pinned':
        conversationsList.onConversationPinned(m);
        break;
      case 'conversation-read':
        chatMessages.onConversationRead(m);
        break;
      case 'conversation-history':
        chatMessages.onConversationHistory(m);
        break;
      case 'conversation-history-around':
        chatMessages.onConversationHistoryAround(m);
        break;
      case 'message-search-results':
        messageSearch.onMessageSearchResults(m);
        break;
      case 'conversation-history-more':
        chatMessages.onConversationHistoryMore(m);
        break;
      case 'chat':
        chatMessages.onChat(m);
        break;
      case 'typing':
        typingIndicator.onTyping(m);
        break;
      case 'chat-deleted':
        chatMessages.onChatDeleted(m);
        break;
      case 'chat-edited':
        chatMessages.onChatEdited(m);
        break;
      case 'invitation-updated':
        chatMessages.onInvitationUpdated(m);
        break;
      case 'chat-attachment-added':
        chatMessages.onChatAttachmentAdded(m);
        break;
      case 'chat-reaction-updated':
        chatMessages.onChatReactionUpdated(m);
        break;
      case 'conversation-deleted':
        conversationsList.onConversationDeleted(m);
        chatMessages.onConversationDeleted(m);
        callLifecycle.onConversationDeleted(m.conversationId);
        break;
      case 'social-changed':
        setSocialRevision((n) => n + 1);
        break;
      case 'presence-sync':
        dispatch({ type: 'PARTICIPANTS_SYNC', participants: m.participants });
        presence.setInitial(m.knownUsers, m.onlineUserIds);
        break;
      case 'user-online':
        presence.onUserOnline(m);
        break;
      case 'user-offline':
        presence.onUserOffline(m);
        break;
      case 'user-deleted':
        presence.onUserDeleted(m);
        break;
      case 'storage-usage':
        attachmentsUpload.onStorageUsage(m);
        break;
      case 'error':
        if (m.code === 'full') {
          disconnectIntentionally();
          dispatch({ type: 'SET_ROOM_ERROR', message: m.message || 'Sala cheia, tente mais tarde.' });
        } else if (m.code === 'cannot-delete-self') {
          setModerationError(m.message);
        } else if (m.code === 'forbidden' || m.code === 'conflict' || m.code === 'not_found') {
          setGroupActionError(m.message);
        } else if (m.code === 'livekit-unavailable') {
          callLifecycle.onLivekitUnavailable();
          dispatch({ type: 'SET_SHARE_ERROR', message: m.message });
        } else if (m.code === 'message-not-found') {
          chatMessages.cancelPendingJump();
          messageSearch.setSearchErrorMessage(m.message);
        } else {
          console.warn('[ws] unhandled server error:', m.code, m.message);
        }
        break;
    }
  }, [
    dispatch, conversationsList, presence, attachmentsUpload, openConversation, callLifecycle,
    messageReactions, messageSearch, chatMessages, typingIndicator, disconnectIntentionally,
  ]);

  useSocketConnection({ socketRef, intentionalCloseRef, sendWs, dispatch, refreshAuth, onMessage: handleServerMessage });

  useEffect(() => {
    preloadSounds();
  }, []);

  useEffect(() => {
    setNotificationClickHandler((conversationId) => {
      openConversation(conversationId);
      requestChatViewRef.current?.();
    });
    return () => setNotificationClickHandler(null);
  }, [openConversation]);

  useEffect(() => () => {
    livekitRoom.disconnect();
  }, [livekitRoom]);

  return (
    <RoomContext.Provider
      value={{
        state, dispatch, sendWs, tileDomRegistry, audioRegistry,
        audioUnlocked: callLifecycle.audioUnlocked, deafened: callLifecycle.deafened, toggleDeafened: callLifecycle.toggleDeafened,
        reconnecting: callLifecycle.reconnecting,
        livekitRoom, notifyActiveView,
        registerRequestChatView, requestChatView,
        activeCallConversationId: callLifecycle.activeCallConversationId, joinCall: callLifecycle.joinCall, leaveCall: callLifecycle.leaveCall,
        startSharing, stopSharing, startCamera, stopCamera, activateMic, toggleMicMuted,
        updateAvatar: profileUpdate.updateAvatar, updateProfile: profileUpdate.updateProfile, uploadProfileImage: profileUpdate.uploadProfileImage,
        menuTarget: tileMenu.menuTarget, openTileMenu: tileMenu.openTileMenu, closeTileMenu: tileMenu.closeTileMenu,
        reactions: messageReactions.reactions, sendReaction: messageReactions.sendReaction,
        showStats: roomSettings.showStats, setShowStats: roomSettings.setShowStats,
        notifyVolume: roomSettings.notifyVolume, setNotifyVolume: roomSettings.setNotifyVolume,
        notificationsEnabled: roomSettings.notificationsEnabled, setNotificationsEnabled: roomSettings.setNotificationsEnabled,
        hideAudioOnlyTiles: roomSettings.hideAudioOnlyTiles, setHideAudioOnlyTiles: roomSettings.setHideAudioOnlyTiles,
        showTileBanners: roomSettings.showTileBanners, setShowTileBanners: roomSettings.setShowTileBanners,
        compressImagesDefault: roomSettings.compressImagesDefault, setCompressImagesDefault: roomSettings.setCompressImagesDefault,
        noiseSuppressionEnabled: roomSettings.noiseSuppressionEnabled, setNoiseSuppressionEnabled: roomSettings.setNoiseSuppressionEnabled,
        conversations: conversationsList.conversations, activeConversationId: conversationsList.activeConversationId,
        openConversation, openDirect: conversationsList.openDirect, closeConversation, pinConversation: conversationsList.pinConversation,
        deleteGroup: conversationsList.deleteGroup,
        updateGroupTitle: conversationsList.updateGroupTitle, updateGroupAvatar: conversationsList.updateGroupAvatar,
        removeGroupMember: conversationsList.removeGroupMember,
        transferGroupOwnership: conversationsList.transferGroupOwnership,
        messagesByConversation: chatMessages.messagesByConversation, hasMoreByConversation: chatMessages.hasMoreByConversation,
        loadingOlderByConversation: chatMessages.loadingOlderByConversation, loadOlderMessages: chatMessages.loadOlderMessages,
        unreadByConversation: chatMessages.unreadByConversation,
        typingByConversation: typingIndicator.typingByConversation, sendTyping: typingIndicator.sendTyping,
        allUsers: presence.allUsers, onlineUserIds: presence.onlineUserIds,
        deleteUserAccount, moderationError, clearModerationError: () => setModerationError(null), kickFromCall: callLifecycle.kickFromCall,
        groupActionError, clearGroupActionError: () => setGroupActionError(null),
        socialRevision,
        sendChatMessage: chatMessages.sendChatMessage, deleteChatMessage: chatMessages.deleteChatMessage,
        editChatMessage: chatMessages.editChatMessage, reactToChatMessage: chatMessages.reactToChatMessage,
        replyingTo: chatMessages.replyingTo, setReplyingTo: chatMessages.setReplyingTo,
        editingMsgId: chatMessages.editingMsgId, setEditingMsgId: chatMessages.setEditingMsgId,
        hasMoreAfterByConversation: chatMessages.hasMoreAfterByConversation, pendingJumpTarget: chatMessages.pendingJumpTarget,
        clearPendingJumpTarget: chatMessages.clearPendingJumpTarget, jumpToMessage: chatMessages.jumpToMessage,
        searchResults: messageSearch.searchResults, searchLoading: messageSearch.searchLoading, searchError: messageSearch.searchError,
        clearSearchError: messageSearch.clearSearchError, searchMessages: messageSearch.searchMessages,
        storageUsage: attachmentsUpload.storageUsage, sendAttachments: attachmentsUpload.sendAttachments,
      }}
    >
      {children}
    </RoomContext.Provider>
  );
}

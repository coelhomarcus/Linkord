import { useCallback, useEffect, useRef, useState, useReducer } from 'react';
import type { ReactNode } from 'react';
import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import { Room } from 'livekit-client';
import { RoomContext } from './RoomContext';
import type { AnchorRect, AudioHandle, CropRect, TileDomHandle } from './RoomContext';
import { roomReducer, initialRoomState } from './roomReducer';
import { useAuth } from './AuthContext';
import { loadIdentity, saveIdentity } from './useIdentitySession';
import { useScreenShare } from '../features/sharing/useScreenShare';
import { useCamera } from '../features/sharing/useCamera';
import { useMicrophone } from '../features/sharing/useMicrophone';
import type { TileKind } from '../features/sharing/tileTypes';
import { useConversationsList } from './hooks/useConversationsList';
import { useChatMessages } from './hooks/useChatMessages';
import { useTypingIndicator } from './hooks/useTypingIndicator';
import { useMessageReactions } from './hooks/useMessageReactions';
import { useMessageSearch } from './hooks/useMessageSearch';
import { useAttachmentsUpload } from './hooks/useAttachmentsUpload';
import { usePresence } from './hooks/usePresence';
import { useCallLifecycle } from './hooks/useCallLifecycle';
import { loadShowStats, saveShowStats, loadNotifyVolume, saveNotifyVolume } from '../features/settings/useSettingsPreference';
import { loadHideAudioOnlyTiles, saveHideAudioOnlyTiles } from '../features/settings/useStageViewPreference';
import { loadShowTileBanners, saveShowTileBanners } from '../features/settings/useTileBannerPreference';
import { loadCompressImages, saveCompressImages } from '../features/settings/useCompressImagesPreference';
import { loadNoiseSuppression, saveNoiseSuppression } from '../features/settings/useNoiseSuppressionPreference';
import { preloadSounds, setVolume } from '../shared/sounds';
import {
  loadNotificationsEnabled, saveNotificationsEnabled, setNotificationsModuleEnabled, setNotificationClickHandler,
} from '../shared/notifications';
import { uploadWithProgress } from '../shared/lib/uploadWithProgress';
import { DEFAULT_AVATAR_COLOR, normalizeAvatarColor } from '../shared/Avatar';
import { sanitizeDisplayName } from '../shared/lib/displayName';
import type { ClientMessage, ServerMessage } from '../types/protocol';
import { MAX_BANNER_LEN, MAX_PROFILE_BIO_LEN, MAX_PROFILE_LINK_LEN, MAX_PROFILE_LINKS } from '../types/protocol';

export { PartialAttachmentError } from './hooks/useAttachmentsUpload';

function sanitizeImageUrl(value: unknown): string {
  const url = String(value == null ? '' : value).trim().slice(0, MAX_BANNER_LEN);
  return /^https?:\/\/\S+$/i.test(url) || /^\/uploads\/[0-9a-f]{32}$/.test(url) ? url : '';
}

function sanitizeBio(value: unknown): string {
  return String(value == null ? '' : value).replace(/\r\n?/g, '\n').trim().slice(0, MAX_PROFILE_BIO_LEN);
}

function sanitizeProfileLinks(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const links: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const url = String(item == null ? '' : item).trim().slice(0, MAX_PROFILE_LINK_LEN);
    if (!/^https?:\/\/\S+$/i.test(url)) continue;
    const key = url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    links.push(url);
    if (links.length >= MAX_PROFILE_LINKS) break;
  }
  return links;
}

export function RoomProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(roomReducer, initialRoomState);
  const { refresh: refreshAuth } = useAuth();

  const socketRef = useRef<Socket | null>(null);
  const myIdRef = useRef<string | null>(null);
  const myUserIdRef = useRef<string | null>(null);
  const myUsernameRef = useRef<string | null>(null);
  const tokenRef = useRef<string | null>(null);
  const intentionalCloseRef = useRef(false);
  const tileDomRegistry = useRef<Map<string, TileDomHandle>>(new Map());
  const audioRegistry = useRef<Map<string, AudioHandle>>(new Map());

  const [livekitRoom] = useState(() => new Room({
    adaptiveStream: true,
    dynacast: true,
  }));

  const [showStats, setShowStatsState] = useState(loadShowStats);
  const setShowStats = useCallback((value: boolean) => {
    setShowStatsState(value);
    saveShowStats(value);
  }, []);

  const [notifyVolume, setNotifyVolumeState] = useState(loadNotifyVolume);
  const setNotifyVolume = useCallback((value: number) => {
    setNotifyVolumeState(value);
    saveNotifyVolume(value);
    setVolume(value);
  }, []);

  const [notificationsEnabled, setNotificationsEnabledState] = useState(loadNotificationsEnabled);
  const setNotificationsEnabled = useCallback((value: boolean) => {
    setNotificationsEnabledState(value);
    saveNotificationsEnabled(value);
    setNotificationsModuleEnabled(value);
  }, []);

  const [hideAudioOnlyTiles, setHideAudioOnlyTilesState] = useState(loadHideAudioOnlyTiles);
  const setHideAudioOnlyTiles = useCallback((value: boolean) => {
    setHideAudioOnlyTilesState(value);
    saveHideAudioOnlyTiles(value);
  }, []);

  const [showTileBanners, setShowTileBannersState] = useState(loadShowTileBanners);
  const setShowTileBanners = useCallback((value: boolean) => {
    setShowTileBannersState(value);
    saveShowTileBanners(value);
  }, []);

  const [compressImagesDefault, setCompressImagesDefaultState] = useState(loadCompressImages);
  const setCompressImagesDefault = useCallback((value: boolean) => {
    setCompressImagesDefaultState(value);
    saveCompressImages(value);
  }, []);

  const sendWs = useCallback((msg: ClientMessage) => {
    if (socketRef.current?.connected) socketRef.current.emit(msg.t, msg);
  }, []);

  const activeViewRef = useRef<'chat' | 'call'>('chat');
  const notifyActiveView = useCallback((view: 'chat' | 'call') => { activeViewRef.current = view; }, []);
  const requestChatViewRef = useRef<(() => void) | null>(null);
  const registerRequestChatView = useCallback((fn: () => void) => { requestChatViewRef.current = fn; }, []);
  const requestChatView = useCallback(() => { requestChatViewRef.current?.(); }, []);

  const [moderationError, setModerationError] = useState<string | null>(null);

  // Domain hooks — each owns one slice of what used to all live directly in
  // this component (see the module comment in each hooks/use*.ts file for
  // why it's split this way). Construction order matters in a couple of
  // spots: presence before chatMessages (chatMessages reads its allUsersRef),
  // and the camera/screen-share/mic hooks before useCallLifecycle (it
  // composes their leave/mute functions).
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

  const [noiseSuppressionEnabled, setNoiseSuppressionEnabledState] = useState(loadNoiseSuppression);
  const setNoiseSuppressionEnabled = useCallback((value: boolean) => {
    setNoiseSuppressionEnabledState(value);
    saveNoiseSuppression(value);
    applyNoiseSuppression(value);
  }, [applyNoiseSuppression]);

  const callLifecycle = useCallLifecycle({
    livekitRoom, dispatch, sendWs, stopCamera, stopSharing, activateMic, setMicMuted, leaveMic,
    cameraOn: state.me.cameraOn, sharing: state.me.sharing,
  });

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
        presence.setInitial(m.users, m.onlineUserIds);
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
      case 'user-online':
        presence.onUserOnline(m);
        break;
      case 'user-offline':
        presence.onUserOffline(m);
        break;
      case 'user-registered':
        presence.onUserRegistered(m);
        break;
      case 'user-deleted':
        presence.onUserDeleted(m);
        break;
      case 'storage-usage':
        attachmentsUpload.onStorageUsage(m);
        break;
      case 'error':
        if (m.code === 'full') {
          intentionalCloseRef.current = true;
          try { socketRef.current?.disconnect(); } catch {  }
          dispatch({ type: 'SET_ROOM_ERROR', message: m.message || 'Sala cheia, tente mais tarde.' });
        } else if (m.code === 'cannot-delete-self') {
          setModerationError(m.message);
        } else if (m.code === 'livekit-unavailable') {
          callLifecycle.onLivekitUnavailable();
          dispatch({ type: 'SET_SHARE_ERROR', message: m.message });
        } else if (m.code === 'message-not-found') {
          chatMessages.cancelPendingJump();
          messageSearch.setSearchErrorMessage(m.message);
        } else {
          console.warn('[ws] erro nao tratado do servidor:', m.code, m.message);
        }
        break;
    }
  }, [
    dispatch, conversationsList, presence, attachmentsUpload, openConversation, callLifecycle,
    messageReactions, messageSearch, chatMessages, typingIndicator,
  ]);

  const handleServerMessageRef = useRef(handleServerMessage);
  useEffect(() => { handleServerMessageRef.current = handleServerMessage; }, [handleServerMessage]);

  const connect = useCallback(() => {
    intentionalCloseRef.current = false;
    const socket = io(location.origin, { path: '/ws', transports: ['websocket'], withCredentials: true });
    socketRef.current = socket;

    socket.on('connect', () => {
      const saved = loadIdentity();
      sendWs({ t: 'join', id: saved?.id, token: saved?.token });
    });

    socket.onAny((_eventName: string, payload: ServerMessage) => handleServerMessageRef.current(payload));

    socket.on('disconnect', () => {
      if (intentionalCloseRef.current) return;
      dispatch({ type: 'SET_RECONNECTING', value: true });
    });

    socket.on('connect_error', () => {
      if (!socket.active) refreshAuth();
    });
  }, [sendWs, refreshAuth]);

  const updateProfile = useCallback((profile: { avatar: string; avatarPoster: string; avatarColor: string; displayName: string; banner: string; bannerPoster: string; bio: string; profileLinks: string[] }) => {
    const finalAvatar = profile.avatar.trim().slice(0, 500);
    const finalAvatarPoster = sanitizeImageUrl(profile.avatarPoster);
    const finalAvatarColor = normalizeAvatarColor(profile.avatarColor) || DEFAULT_AVATAR_COLOR;
    const finalDisplayName = sanitizeDisplayName(profile.displayName) || state.me.name;
    const finalBanner = sanitizeImageUrl(profile.banner);
    const finalBannerPoster = sanitizeImageUrl(profile.bannerPoster);
    const finalBio = sanitizeBio(profile.bio);
    const finalProfileLinks = sanitizeProfileLinks(profile.profileLinks);
    dispatch({
      type: 'SET_LOCAL_PROFILE',
      avatar: finalAvatar,
      avatarPoster: finalAvatarPoster,
      avatarColor: finalAvatarColor,
      displayName: finalDisplayName,
      banner: finalBanner,
      bannerPoster: finalBannerPoster,
      bio: finalBio,
      profileLinks: finalProfileLinks,
    });
    presence.setAllUsers((prev) => {
      const userId = myUserIdRef.current;
      if (!userId) return prev;
      const existing = prev.get(userId);
      if (!existing || (
        existing.avatar === finalAvatar && existing.avatarColor === finalAvatarColor && existing.displayName === finalDisplayName
        && existing.banner === finalBanner && existing.bio === finalBio
        && JSON.stringify(existing.profileLinks) === JSON.stringify(finalProfileLinks)
      )) return prev;
      const next = new Map(prev);
      next.set(userId, {
        ...existing,
        avatar: finalAvatar,
        avatarColor: finalAvatarColor,
        displayName: finalDisplayName,
        banner: finalBanner,
        bio: finalBio,
        profileLinks: finalProfileLinks,
      });
      return next;
    });
    sendWs({
      t: 'profile',
      avatar: finalAvatar,
      avatarPoster: finalAvatarPoster,
      avatarColor: finalAvatarColor,
      displayName: finalDisplayName,
      banner: finalBanner,
      bannerPoster: finalBannerPoster,
      bio: finalBio,
      profileLinks: finalProfileLinks,
    });
  }, [dispatch, sendWs, state.me.name, presence.setAllUsers]);

  const updateAvatar = useCallback((avatar: string) => {
    updateProfile({
      avatar,
      avatarPoster: '', // a poster only exists for an animated avatar generated by our own upload pipeline — never known here
      avatarColor: state.me.avatarColor,
      displayName: state.me.displayName,
      banner: state.me.banner,
      bannerPoster: state.me.bannerPoster,
      bio: state.me.bio,
      profileLinks: state.me.profileLinks,
    });
  }, [state.me.avatarColor, state.me.banner, state.me.bannerPoster, state.me.bio, state.me.displayName, state.me.profileLinks, updateProfile]);

  const uploadProfileImageBody = useCallback(async (
    field: 'avatar' | 'banner',
    body: Blob,
    headers: Record<string, string>,
    crop: CropRect,
    onProgress?: (fraction: number) => void,
    profile?: { avatarColor?: string; displayName?: string; avatar?: string; banner?: string; bio?: string; profileLinks?: string[] }
  ) => {
    const res = await uploadWithProgress<{ avatar: string; avatarPoster?: string }>({
      url: `/api/avatar?crop=${encodeURIComponent(JSON.stringify(crop))}`,
      file: body,
      headers,
      onProgress,
    });
    const url = res.avatar;
    const posterUrl = res.avatarPoster ?? '';
    updateProfile({
      avatar: field === 'avatar' ? url : (profile?.avatar ?? state.me.avatar),
      avatarPoster: field === 'avatar' ? posterUrl : state.me.avatarPoster,
      avatarColor: profile?.avatarColor ?? state.me.avatarColor,
      displayName: profile?.displayName ?? state.me.displayName,
      banner: field === 'banner' ? url : (profile?.banner ?? state.me.banner),
      bannerPoster: field === 'banner' ? posterUrl : state.me.bannerPoster,
      bio: profile?.bio ?? state.me.bio,
      profileLinks: profile?.profileLinks ?? state.me.profileLinks,
    });
    return url;
  }, [state.me.avatar, state.me.avatarPoster, state.me.avatarColor, state.me.banner, state.me.bannerPoster, state.me.bio, state.me.displayName, state.me.profileLinks, updateProfile]);

  const uploadProfileImage = useCallback((
    field: 'avatar' | 'banner',
    file: Blob,
    crop: CropRect,
    onProgress?: (fraction: number) => void,
    profile?: { avatarColor?: string; displayName?: string; avatar?: string; banner?: string; bio?: string; profileLinks?: string[] }
  ) => uploadProfileImageBody(field, file, { 'Content-Type': file.type || 'application/octet-stream' }, crop, onProgress, profile),
  [uploadProfileImageBody]);

  const [menuTarget, setMenuTarget] = useState<{ key: string; participantId: string; kind: TileKind; rect: AnchorRect } | null>(null);
  const menuOpenRef = useRef(false);

  const openTileMenu = useCallback((key: string, participantId: string, kind: TileKind, rect: AnchorRect) => {
    menuOpenRef.current = true;
    setMenuTarget({ key, participantId, kind, rect });
  }, []);
  const closeTileMenu = useCallback(() => {
    if (!menuOpenRef.current) return false;
    menuOpenRef.current = false;
    setMenuTarget(null);
    return true;
  }, []);

  useEffect(() => {
    preloadSounds();
  }, []);

  useEffect(() => {
    setVolume(notifyVolume);
  }, [notifyVolume]);

  useEffect(() => {
    setNotificationsModuleEnabled(notificationsEnabled);
  }, [notificationsEnabled]);

  useEffect(() => {
    setNotificationClickHandler((conversationId) => {
      openConversation(conversationId);
      requestChatViewRef.current?.();
    });
    return () => setNotificationClickHandler(null);
  }, [openConversation]);

  useEffect(() => {
    connect();
    return () => {
      intentionalCloseRef.current = true;
      socketRef.current?.disconnect();
      livekitRoom.disconnect();
    };
  }, [connect, livekitRoom]);

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
        updateAvatar, updateProfile, uploadProfileImage, menuTarget, openTileMenu, closeTileMenu,
        reactions: messageReactions.reactions, sendReaction: messageReactions.sendReaction,
        showStats, setShowStats, notifyVolume, setNotifyVolume, notificationsEnabled, setNotificationsEnabled,
        hideAudioOnlyTiles, setHideAudioOnlyTiles, showTileBanners, setShowTileBanners,
        compressImagesDefault, setCompressImagesDefault,
        noiseSuppressionEnabled, setNoiseSuppressionEnabled,
        conversations: conversationsList.conversations, activeConversationId: conversationsList.activeConversationId,
        openConversation, openDirect: conversationsList.openDirect, closeConversation, pinConversation: conversationsList.pinConversation,
        createGroup: conversationsList.createGroup, deleteGroup: conversationsList.deleteGroup,
        updateGroupTitle: conversationsList.updateGroupTitle, updateGroupAvatar: conversationsList.updateGroupAvatar,
        addGroupMembers: conversationsList.addGroupMembers, removeGroupMember: conversationsList.removeGroupMember,
        messagesByConversation: chatMessages.messagesByConversation, hasMoreByConversation: chatMessages.hasMoreByConversation,
        loadingOlderByConversation: chatMessages.loadingOlderByConversation, loadOlderMessages: chatMessages.loadOlderMessages,
        unreadByConversation: chatMessages.unreadByConversation,
        typingByConversation: typingIndicator.typingByConversation, sendTyping: typingIndicator.sendTyping,
        allUsers: presence.allUsers, onlineUserIds: presence.onlineUserIds,
        deleteUserAccount, moderationError, clearModerationError: () => setModerationError(null), kickFromCall: callLifecycle.kickFromCall,
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

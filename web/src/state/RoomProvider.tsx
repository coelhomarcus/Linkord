import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import { DisconnectReason, Room, RoomEvent, Track } from 'livekit-client';
import type { LocalTrackPublication, Track as LKTrack } from 'livekit-client';
import { RoomContext } from './RoomContext';
import type { AnchorRect, AudioHandle, ReactionEvent, TileDomHandle } from './RoomContext';
import { roomReducer, initialRoomState } from './roomReducer';
import { useAuth } from './AuthContext';
import { loadIdentity, saveIdentity } from './useIdentitySession';
import { useScreenShare } from '../features/sharing/useScreenShare';
import { useCamera } from '../features/sharing/useCamera';
import { useMicrophone } from '../features/sharing/useMicrophone';
import { useTrackSpeaking } from '../features/sharing/useLiveKitTrack';
import type { TileKind } from '../features/sharing/tileTypes';
import { loadShowStats, saveShowStats, loadNotifyVolume, saveNotifyVolume } from '../features/settings/useSettingsPreference';
import { loadHideAudioOnlyTiles, saveHideAudioOnlyTiles } from '../features/settings/useStageViewPreference';
import { playSound, preloadSounds, setVolume } from '../shared/sounds';
import {
  loadNotificationsEnabled, saveNotificationsEnabled, setNotificationsModuleEnabled,
  setNotificationClickHandler, notifyIncomingChatMessage,
} from '../shared/notifications';
import { mentionsUsername } from '../shared/lib/mentions';
import { uploadWithProgress } from '../shared/lib/uploadWithProgress';
import { uploadFileInChunks } from '../shared/lib/chunkedUpload';
import { DEFAULT_AVATAR_COLOR, normalizeAvatarColor } from '../shared/Avatar';
import { sanitizeDisplayName } from '../shared/lib/displayName';
import type { ChatMessage, ClientMessage, Conversation, Participant, PublicUser, ReactionEmoji, SearchResult, ServerMessage, StorageUsage } from '../types/protocol';
import { MAX_BANNER_LEN, MAX_PROFILE_BIO_LEN, MAX_PROFILE_LINK_LEN, MAX_PROFILE_LINKS } from '../types/protocol';

const REACTION_DURATION_MS = 3000;
const CHAT_CLIENT_LIMIT = 300;

export class PartialAttachmentError extends Error {
  sentCount: number;
  totalCount: number;
  constructor(sentCount: number, totalCount: number) {
    super(`partial_attachment_failure: ${sentCount}/${totalCount}`);
    this.sentCount = sentCount;
    this.totalCount = totalCount;
  }
}

function mergeUserFromParticipant(prev: Map<string, PublicUser>, participant: Participant): Map<string, PublicUser> {
  const existing = prev.get(participant.userId);
  if (!existing || (
    existing.avatar === participant.avatar
    && existing.avatarColor === participant.avatarColor
    && existing.displayName === participant.displayName
    && existing.banner === participant.banner
    && existing.bio === participant.bio
    && JSON.stringify(existing.profileLinks) === JSON.stringify(participant.profileLinks)
    && existing.role === participant.role
  )) return prev;
  const next = new Map(prev);
  next.set(participant.userId, {
    ...existing, avatar: participant.avatar, avatarColor: participant.avatarColor,
    displayName: participant.displayName, banner: participant.banner, bio: participant.bio,
    profileLinks: participant.profileLinks, role: participant.role,
  });
  return next;
}

function displayNameForConversation(conversation: Conversation | undefined, meUserId: string | null, users: Map<string, PublicUser>): string {
  if (!conversation) return 'Conversa';
  if (conversation.type === 'group') return conversation.title || 'Grupo';
  const otherId = conversation.memberIds.find((id) => id !== meUserId) ?? conversation.memberIds[0];
  const other = otherId ? users.get(otherId) : undefined;
  return other?.displayName || other?.username || 'Conversa direta';
}

function sanitizeBanner(value: unknown): string {
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

  const [audioUnlocked, setAudioUnlocked] = useState(false);
  useEffect(() => {
    if (audioUnlocked) return;
    const unlock = () => setAudioUnlocked(true);
    document.addEventListener('pointerdown', unlock, { once: true });
    document.addEventListener('keydown', unlock, { once: true });
    return () => {
      document.removeEventListener('pointerdown', unlock);
      document.removeEventListener('keydown', unlock);
    };
  }, [audioUnlocked]);

  const [deafened, setDeafened] = useState(false);

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

  const sendWs = useCallback((msg: ClientMessage) => {
    if (socketRef.current?.connected) socketRef.current.emit(msg.t, msg);
  }, []);

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const conversationsRef = useRef<Conversation[]>([]);
  const [activeConversationId, setActiveConversationIdState] = useState<string | null>(null);
  const activeConversationIdRef = useRef<string | null>(null);
  const [activeCallConversationId, setActiveCallConversationIdState] = useState<string | null>(null);
  const activeCallConversationIdRef = useRef<string | null>(null);
  const pendingCallConversationIdRef = useRef<string | null>(null);
  const setActiveCallConversationId = useCallback((id: string | null) => {
    activeCallConversationIdRef.current = id;
    setActiveCallConversationIdState(id);
  }, []);
  const activeViewRef = useRef<'chat' | 'call'>('chat');
  const notifyActiveView = useCallback((view: 'chat' | 'call') => { activeViewRef.current = view; }, []);
  const requestChatViewRef = useRef<(() => void) | null>(null);
  const registerRequestChatView = useCallback((fn: () => void) => { requestChatViewRef.current = fn; }, []);
  const requestChatView = useCallback(() => { requestChatViewRef.current?.(); }, []);
  const [messagesByConversation, setMessagesByConversation] = useState<Map<string, ChatMessage[]>>(new Map());
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [editingMsgId, setEditingMsgId] = useState<number | null>(null);
  const messagesByConversationRef = useRef<Map<string, ChatMessage[]>>(new Map());
  useEffect(() => { messagesByConversationRef.current = messagesByConversation; }, [messagesByConversation]);
  const [hasMoreByConversation, setHasMoreByConversation] = useState<Map<string, boolean>>(new Map());
  const hasMoreByConversationRef = useRef<Map<string, boolean>>(new Map());
  useEffect(() => { hasMoreByConversationRef.current = hasMoreByConversation; }, [hasMoreByConversation]);
  const [hasMoreAfterByConversation, setHasMoreAfterByConversation] = useState<Map<string, boolean>>(new Map());
  const [loadingOlderByConversation, setLoadingOlderByConversation] = useState<Set<string>>(new Set());
  const loadingOlderRef = useRef<Set<string>>(new Set());
  const [unreadByConversation, setUnreadByConversation] = useState<Map<string, number>>(new Map());
  const [allUsers, setAllUsers] = useState<Map<string, PublicUser>>(new Map());
  const allUsersRef = useRef<Map<string, PublicUser>>(new Map());
  useEffect(() => { allUsersRef.current = allUsers; }, [allUsers]);
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set());
  const [storageUsage, setStorageUsage] = useState<StorageUsage>({ totalBytes: 0, totalFiles: 0, maxBytes: 0 });
  const [moderationError, setModerationError] = useState<string | null>(null);

  const switchActiveConversation = useCallback((conversationId: string) => {
    activeConversationIdRef.current = conversationId;
    setActiveConversationIdState(conversationId);
    setUnreadByConversation((prev) => {
      if (!prev.has(conversationId)) return prev;
      const next = new Map(prev);
      next.delete(conversationId);
      return next;
    });
    setReplyingTo(null);
    setEditingMsgId(null);
  }, []);

  const openConversation = useCallback((conversationId: string) => {
    switchActiveConversation(conversationId);
    sendWs({ t: 'conversation-open', conversationId });
  }, [sendWs, switchActiveConversation]);

  const openDirect = useCallback((userId: string) => sendWs({ t: 'direct-open', userId }), [sendWs]);
  const createGroup = useCallback((title: string, memberIds: string[]) => sendWs({ t: 'group-create', title, memberIds }), [sendWs]);
  const deleteGroup = useCallback((conversationId: string) => sendWs({ t: 'group-delete', conversationId }), [sendWs]);
  const updateGroupTitle = useCallback((conversationId: string, title: string) => sendWs({ t: 'group-update', conversationId, title }), [sendWs]);
  const updateGroupAvatar = useCallback((conversationId: string, avatar: string) => sendWs({ t: 'group-update', conversationId, avatar }), [sendWs]);
  const addGroupMembers = useCallback((conversationId: string, memberIds: string[]) => sendWs({ t: 'group-members-add', conversationId, memberIds }), [sendWs]);
  const removeGroupMember = useCallback((conversationId: string, userId: string) => sendWs({ t: 'group-members-remove', conversationId, userId }), [sendWs]);

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
    if (conversationId !== activeConversationIdRef.current) switchActiveConversation(conversationId);
    setPendingJumpTargetState({ conversationId, msgId });
    if (alreadyLoaded) return;
    pendingJumpRef.current = { conversationId, msgId };
    sendWs({ t: 'load-messages-around', conversationId, msgId });
  }, [sendWs, switchActiveConversation]);

  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const pendingSearchRef = useRef<{ query: string; conversationId?: string } | null>(null);
  const clearSearchError = useCallback(() => setSearchError(null), []);

  const searchMessages = useCallback((query: string, conversationId?: string) => {
    const trimmed = query.trim();
    if (!trimmed) {
      pendingSearchRef.current = null;
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }
    pendingSearchRef.current = { query: trimmed, conversationId };
    setSearchLoading(true);
    sendWs({ t: 'message-search', query: trimmed, ...(conversationId ? { conversationId } : {}) });
  }, [sendWs]);

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

  const sendAttachments = useCallback(async (
    conversationId: string, files: File[], caption: string, onProgress?: (fileIndex: number, fraction: number) => void
  ): Promise<void> => {
    if (!files.length) return;
    const msgId = await uploadFileInChunks({ conversationId, file: files[0]!, caption, onProgress: (f) => onProgress?.(0, f) });
    for (let i = 1; i < files.length; i++) {
      try {
        await uploadFileInChunks({ conversationId, file: files[i]!, caption: '', targetMsgId: msgId, onProgress: (f) => onProgress?.(i, f) });
      } catch {
        throw new PartialAttachmentError(i, files.length);
      }
    }
  }, []);

  const deleteUserAccount = useCallback((userId: string) => sendWs({ t: 'user-delete', userId }), [sendWs]);
  const kickFromCall = useCallback((participantId: string) => sendWs({ t: 'call-kick', participantId }), [sendWs]);

  const { startSharing, stopSharing } = useScreenShare(livekitRoom, dispatch);
  const { startCamera, stopCamera } = useCamera(livekitRoom, dispatch);
  const { activateMic, toggleMicMuted, setMicMuted, leaveMic } = useMicrophone(livekitRoom, dispatch);

  const toggleDeafened = useCallback(() => {
    const next = !deafened;
    setDeafened(next);
    if (next) setMicMuted(true);
    playSound(next ? 'deafened' : 'undeafened');
    sendWs({ t: 'deafened', value: next });
  }, [deafened, setMicMuted, sendWs]);

  const leaveGroupCall = useCallback(async () => {
    if (state.me.cameraOn) stopCamera();
    if (state.me.sharing) stopSharing();
    await leaveMic();
    livekitRoom.disconnect();
    sendWs({ t: 'call-leave' });
    pendingCallConversationIdRef.current = null;
    setActiveCallConversationId(null);
  }, [state.me.cameraOn, state.me.sharing, stopCamera, stopSharing, leaveMic, livekitRoom, sendWs, setActiveCallConversationId]);

  const joinGroupCall = useCallback(async (conversationId: string) => {
    if (activeCallConversationIdRef.current === conversationId) return;
    if (activeCallConversationIdRef.current) await leaveGroupCall();
    pendingCallConversationIdRef.current = conversationId;
    sendWs({ t: 'call-join', conversationId });
  }, [sendWs, leaveGroupCall]);

  const leaveGroupCallRef = useRef(leaveGroupCall);
  useEffect(() => { leaveGroupCallRef.current = leaveGroupCall; }, [leaveGroupCall]);

  useEffect(() => {
    const onDisconnected = (reason?: DisconnectReason) => {
      if (reason === DisconnectReason.CLIENT_INITIATED) return;
      if (state.me.cameraOn) stopCamera();
      if (state.me.sharing) stopSharing();
      setActiveCallConversationId(null);
    };
    livekitRoom.on(RoomEvent.Disconnected, onDisconnected);
    return () => { livekitRoom.off(RoomEvent.Disconnected, onDisconnected); };
  }, [livekitRoom, stopCamera, stopSharing, setActiveCallConversationId, state.me.cameraOn, state.me.sharing]);

  useEffect(() => {
    const onLocalUnpublished = (pub: LocalTrackPublication) => {
      if (pub.source === Track.Source.ScreenShare) dispatch({ type: 'SET_LOCAL_SHARING', sharing: false });
      if (pub.source === Track.Source.Camera) dispatch({ type: 'SET_LOCAL_CAMERA', on: false });
    };
    livekitRoom.on(RoomEvent.LocalTrackUnpublished, onLocalUnpublished);
    return () => { livekitRoom.off(RoomEvent.LocalTrackUnpublished, onLocalUnpublished); };
  }, [livekitRoom, dispatch]);

  useEffect(() => {
    const onPublished = (pub: { source: Track.Source }) => {
      if (pub.source === Track.Source.Microphone) playSound('incomingUser');
      if (pub.source === Track.Source.ScreenShare) playSound('screenshare');
      if (pub.source === Track.Source.Camera) playSound('camera');
    };
    const onLocalPublished = (pub: { source: Track.Source }) => {
      onPublished(pub);
      if (pub.source === Track.Source.Microphone) sendWs({ t: 'call-event', kind: 'joined' });
      if (pub.source === Track.Source.ScreenShare) sendWs({ t: 'call-event', kind: 'screenshare' });
    };
    const onMicUnpublished = (pub: { source: Track.Source }) => {
      if (pub.source === Track.Source.Microphone) playSound('userLeave');
    };
    livekitRoom.on(RoomEvent.TrackPublished, onPublished);
    livekitRoom.on(RoomEvent.TrackUnpublished, onMicUnpublished);
    livekitRoom.on(RoomEvent.LocalTrackPublished, onLocalPublished);
    livekitRoom.on(RoomEvent.LocalTrackUnpublished, onMicUnpublished);
    return () => {
      livekitRoom.off(RoomEvent.TrackPublished, onPublished);
      livekitRoom.off(RoomEvent.TrackUnpublished, onMicUnpublished);
      livekitRoom.off(RoomEvent.LocalTrackPublished, onLocalPublished);
      livekitRoom.off(RoomEvent.LocalTrackUnpublished, onMicUnpublished);
    };
  }, [livekitRoom, sendWs]);

  const [localMic, setLocalMic] = useState<{ track: LKTrack | null; muted: boolean }>({ track: null, muted: true });
  useEffect(() => {
    function reportMic() {
      const pub = livekitRoom.localParticipant.getTrackPublication(Track.Source.Microphone);
      setLocalMic({ track: pub?.track ?? null, muted: pub ? pub.isMuted : true });
      sendWs({ t: 'mic-state', activated: !!pub, muted: pub ? pub.isMuted : true });
    }
    function reportCamera() {
      sendWs({ t: 'camera', on: !!livekitRoom.localParticipant.getTrackPublication(Track.Source.Camera) });
    }
    function reportSharing() {
      sendWs({ t: 'screen-share', on: !!livekitRoom.localParticipant.getTrackPublication(Track.Source.ScreenShare) });
    }
    const onPublishChange = (pub: { source: Track.Source }) => {
      if (pub.source === Track.Source.Microphone) reportMic();
      if (pub.source === Track.Source.Camera) reportCamera();
      if (pub.source === Track.Source.ScreenShare) reportSharing();
    };
    const onMuteChange = (pub: { source: Track.Source }, participant: { identity: string }) => {
      if (participant.identity === livekitRoom.localParticipant.identity && pub.source === Track.Source.Microphone) reportMic();
    };
    livekitRoom.on(RoomEvent.LocalTrackPublished, onPublishChange);
    livekitRoom.on(RoomEvent.LocalTrackUnpublished, onPublishChange);
    livekitRoom.on(RoomEvent.TrackMuted, onMuteChange);
    livekitRoom.on(RoomEvent.TrackUnmuted, onMuteChange);
    return () => {
      livekitRoom.off(RoomEvent.LocalTrackPublished, onPublishChange);
      livekitRoom.off(RoomEvent.LocalTrackUnpublished, onPublishChange);
      livekitRoom.off(RoomEvent.TrackMuted, onMuteChange);
      livekitRoom.off(RoomEvent.TrackUnmuted, onMuteChange);
    };
  }, [livekitRoom, sendWs]);

  const isSpeakingLocal = useTrackSpeaking(localMic.track, localMic.muted);
  useEffect(() => {
    sendWs({ t: 'speaking', value: isSpeakingLocal });
  }, [isSpeakingLocal, sendWs]);

  const [reactions, setReactions] = useState<ReactionEvent[]>([]);
  const reactionKeyRef = useRef(0);

  const pushReaction = useCallback((id: string, emoji: ReactionEmoji) => {
    const key = reactionKeyRef.current++;
    const left = 12 + Math.random() * 76;
    setReactions((prev) => [...prev, { key, id, emoji, left }]);
    setTimeout(() => setReactions((prev) => prev.filter((r) => r.key !== key)), REACTION_DURATION_MS);
  }, []);

  const sendReaction = useCallback((emoji: ReactionEmoji) => {
    sendWs({ t: 'reaction', emoji });
    if (myIdRef.current) pushReaction(myIdRef.current, emoji);
  }, [pushReaction, sendWs]);

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
          avatarColor: m.avatarColor,
          banner: m.banner,
          bio: m.bio,
          profileLinks: m.profileLinks,
          role: m.role,
          participants: m.participants,
        });
        setConversations(m.conversations ?? []);
        conversationsRef.current = m.conversations ?? [];
        const usersMap = new Map(m.users.map((u) => [u.id, u]));
        setAllUsers(usersMap);
        setOnlineUserIds(new Set(m.onlineUserIds));
        setStorageUsage(m.storageUsage);
        {
          const firstConversation = (m.conversations ?? [])[0];
          if (firstConversation) openConversation(firstConversation.id);
        }
        break;
      }
      case 'call-token': {
        if (m.conversationId !== pendingCallConversationIdRef.current) break;
        livekitRoom.connect(m.livekitUrl, m.livekitToken)
          .then(() => activateMic())
          .catch((err) => console.warn('LiveKit connect falhou', err));
        setActiveCallConversationId(m.conversationId);
        break;
      }
      case 'participant-joined':
        dispatch({ type: 'PARTICIPANT_JOINED', participant: m.participant });
        setAllUsers((prev) => mergeUserFromParticipant(prev, m.participant));
        break;
      case 'participant-updated':
        dispatch({ type: 'PARTICIPANT_UPDATED', participant: m.participant });
        setAllUsers((prev) => mergeUserFromParticipant(prev, m.participant));
        break;
      case 'participant-left':
        dispatch({ type: 'PARTICIPANT_LEFT', id: m.id });
        break;
      case 'reaction':
        pushReaction(m.id, m.emoji);
        break;
      case 'conversation-list':
        setConversations(m.conversations);
        conversationsRef.current = m.conversations;
        break;
      case 'conversation-opened':
        openConversation(m.conversationId);
        break;
      case 'conversation-history':
        setMessagesByConversation((prev) => new Map(prev).set(m.conversationId, m.messages));
        setHasMoreByConversation((prev) => new Map(prev).set(m.conversationId, m.hasMore));
        setHasMoreAfterByConversation((prev) => new Map(prev).set(m.conversationId, false));
        break;
      case 'conversation-history-around': {
        const pending = pendingJumpRef.current;
        if (!pending || pending.conversationId !== m.conversationId || pending.msgId !== m.msgId) break;
        pendingJumpRef.current = null;
        setMessagesByConversation((prev) => new Map(prev).set(m.conversationId, m.messages));
        setHasMoreByConversation((prev) => new Map(prev).set(m.conversationId, m.hasMoreBefore));
        setHasMoreAfterByConversation((prev) => new Map(prev).set(m.conversationId, m.hasMoreAfter));
        break;
      }
      case 'message-search-results': {
        const pending = pendingSearchRef.current;
        if (!pending || pending.query !== m.query || pending.conversationId !== m.conversationId) break;
        setSearchResults(m.results);
        setSearchLoading(false);
        break;
      }
      case 'conversation-history-more': {
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
        break;
      }
      case 'chat': {
        const conversationId = m.message.conversationId;
        setMessagesByConversation((prev) => {
          const existing = prev.get(conversationId) || [];
          const next = [...existing, m.message];
          return new Map(prev).set(conversationId, next.length > CHAT_CLIENT_LIMIT ? next.slice(next.length - CHAT_CLIENT_LIMIT) : next);
        });
        if (conversationId !== activeConversationIdRef.current) {
          setUnreadByConversation((prev) => new Map(prev).set(conversationId, (prev.get(conversationId) || 0) + 1));
        }
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
        break;
      }
      case 'chat-deleted':
        setMessagesByConversation((prev) => {
          const existing = prev.get(m.conversationId);
          if (!existing) return prev;
          return new Map(prev).set(m.conversationId, existing.filter((msg) => msg.msgId !== m.msgId));
        });
        break;
      case 'chat-edited': {
        const conversationId = m.message.conversationId;
        setMessagesByConversation((prev) => {
          const existing = prev.get(conversationId);
          if (!existing) return prev;
          return new Map(prev).set(conversationId, existing.map((msg) => (msg.msgId === m.message.msgId ? m.message : msg)));
        });
        break;
      }
      case 'chat-attachment-added':
        setMessagesByConversation((prev) => {
          const existing = prev.get(m.conversationId);
          if (!existing) return prev;
          return new Map(prev).set(m.conversationId, existing.map((msg) => (
            msg.msgId === m.msgId ? { ...msg, attachments: [...(msg.attachments || []), m.attachment] } : msg
          )));
        });
        break;
      case 'chat-reaction-updated':
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
        break;
      case 'conversation-deleted':
        setConversations((prev) => prev.filter((c) => c.id !== m.conversationId));
        conversationsRef.current = conversationsRef.current.filter((c) => c.id !== m.conversationId);
        setMessagesByConversation((prev) => {
          if (!prev.has(m.conversationId)) return prev;
          const next = new Map(prev);
          next.delete(m.conversationId);
          return next;
        });
        setUnreadByConversation((prev) => {
          if (!prev.has(m.conversationId)) return prev;
          const next = new Map(prev);
          next.delete(m.conversationId);
          return next;
        });
        if (m.conversationId === activeCallConversationIdRef.current) leaveGroupCallRef.current();
        if (m.conversationId === activeConversationIdRef.current) {
          activeConversationIdRef.current = null;
          setActiveConversationIdState(null);
        }
        break;
      case 'user-online':
        setOnlineUserIds((prev) => (prev.has(m.userId) ? prev : new Set(prev).add(m.userId)));
        break;
      case 'user-offline':
        setOnlineUserIds((prev) => {
          if (!prev.has(m.userId)) return prev;
          const next = new Set(prev);
          next.delete(m.userId);
          return next;
        });
        break;
      case 'user-registered':
        setAllUsers((prev) => new Map(prev).set(m.user.id, m.user));
        break;
      case 'user-deleted':
        setAllUsers((prev) => {
          if (!prev.has(m.userId)) return prev;
          const next = new Map(prev);
          next.delete(m.userId);
          return next;
        });
        setOnlineUserIds((prev) => {
          if (!prev.has(m.userId)) return prev;
          const next = new Set(prev);
          next.delete(m.userId);
          return next;
        });
        break;
      case 'storage-usage':
        setStorageUsage({ totalBytes: m.totalBytes, totalFiles: m.totalFiles, maxBytes: m.maxBytes });
        break;
      case 'error':
        if (m.code === 'full') {
          intentionalCloseRef.current = true;
          try { socketRef.current?.disconnect(); } catch {  }
          dispatch({ type: 'SET_ROOM_ERROR', message: m.message || 'Sala cheia, tente mais tarde.' });
        } else if (m.code === 'cannot-delete-self') {
          setModerationError(m.message);
        } else if (m.code === 'livekit-unavailable') {
          pendingCallConversationIdRef.current = null;
          dispatch({ type: 'SET_SHARE_ERROR', message: m.message });
        } else if (m.code === 'message-not-found') {
          pendingJumpRef.current = null;
          setPendingJumpTargetState(null);
          setSearchError(m.message);
        } else {
          console.warn('[ws] erro nao tratado do servidor:', m.code, m.message);
        }
        break;
    }
  }, [dispatch, pushReaction, livekitRoom, openConversation, activateMic, setActiveCallConversationId]);

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

  const updateProfile = useCallback((profile: { avatar: string; avatarColor: string; displayName: string; banner: string; bio: string; profileLinks: string[] }) => {
    const finalAvatar = profile.avatar.trim().slice(0, 500);
    const finalAvatarColor = normalizeAvatarColor(profile.avatarColor) || DEFAULT_AVATAR_COLOR;
    const finalDisplayName = sanitizeDisplayName(profile.displayName) || state.me.name;
    const finalBanner = sanitizeBanner(profile.banner);
    const finalBio = sanitizeBio(profile.bio);
    const finalProfileLinks = sanitizeProfileLinks(profile.profileLinks);
    dispatch({
      type: 'SET_LOCAL_PROFILE',
      avatar: finalAvatar,
      avatarColor: finalAvatarColor,
      displayName: finalDisplayName,
      banner: finalBanner,
      bio: finalBio,
      profileLinks: finalProfileLinks,
    });
    setAllUsers((prev) => {
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
      avatarColor: finalAvatarColor,
      displayName: finalDisplayName,
      banner: finalBanner,
      bio: finalBio,
      profileLinks: finalProfileLinks,
    });
  }, [dispatch, sendWs, state.me.name]);

  const updateAvatar = useCallback((avatar: string) => {
    updateProfile({
      avatar,
      avatarColor: state.me.avatarColor,
      displayName: state.me.displayName,
      banner: state.me.banner,
      bio: state.me.bio,
      profileLinks: state.me.profileLinks,
    });
  }, [state.me.avatarColor, state.me.banner, state.me.bio, state.me.displayName, state.me.profileLinks, updateProfile]);

  const uploadProfileImage = useCallback(async (
    field: 'avatar' | 'banner',
    blob: Blob,
    onProgress?: (fraction: number) => void,
    profile?: { avatarColor?: string; displayName?: string; avatar?: string; banner?: string; bio?: string; profileLinks?: string[] }
  ) => {
    const body = await uploadWithProgress<{ avatar: string }>({
      url: '/api/avatar',
      file: blob,
      headers: { 'Content-Type': blob.type || 'application/octet-stream' },
      onProgress,
    });
    const url = body.avatar;
    updateProfile({
      avatar: field === 'avatar' ? url : (profile?.avatar ?? state.me.avatar),
      avatarColor: profile?.avatarColor ?? state.me.avatarColor,
      displayName: profile?.displayName ?? state.me.displayName,
      banner: field === 'banner' ? url : (profile?.banner ?? state.me.banner),
      bio: profile?.bio ?? state.me.bio,
      profileLinks: profile?.profileLinks ?? state.me.profileLinks,
    });
    return url;
  }, [state.me.avatar, state.me.avatarColor, state.me.banner, state.me.bio, state.me.displayName, state.me.profileLinks, updateProfile]);

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
        state, dispatch, sendWs, tileDomRegistry, audioRegistry, audioUnlocked, deafened, toggleDeafened, livekitRoom, notifyActiveView,
        registerRequestChatView, requestChatView,
        activeCallConversationId, joinGroupCall, leaveGroupCall,
        startSharing, stopSharing, startCamera, stopCamera, activateMic, toggleMicMuted,
        updateAvatar, updateProfile, uploadProfileImage, menuTarget, openTileMenu, closeTileMenu,
        reactions, sendReaction, showStats, setShowStats, notifyVolume, setNotifyVolume, notificationsEnabled, setNotificationsEnabled,
        hideAudioOnlyTiles, setHideAudioOnlyTiles,
        conversations, activeConversationId, openConversation, openDirect, createGroup, deleteGroup,
        updateGroupTitle, updateGroupAvatar, addGroupMembers, removeGroupMember,
        messagesByConversation, hasMoreByConversation, loadingOlderByConversation, loadOlderMessages, unreadByConversation,
        allUsers, onlineUserIds,
        deleteUserAccount, moderationError, clearModerationError: () => setModerationError(null), kickFromCall,
        sendChatMessage, deleteChatMessage, editChatMessage, reactToChatMessage,
        replyingTo, setReplyingTo, editingMsgId, setEditingMsgId,
        hasMoreAfterByConversation, pendingJumpTarget, clearPendingJumpTarget, jumpToMessage,
        searchResults, searchLoading, searchError, clearSearchError, searchMessages,
        storageUsage, sendAttachments,
      }}
    >
      {children}
    </RoomContext.Provider>
  );
}

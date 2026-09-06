import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import { Room, RoomEvent, Track } from 'livekit-client';
import type { LocalTrackPublication, Track as LKTrack } from 'livekit-client';
import { RoomContext } from './RoomContext';
import type {
  AnchorRect,
  AudioHandle,
  ReactionEvent,
  TileDomHandle,
  VoiceConnectionState,
  VoiceJoinOptions,
} from './RoomContext';
import { roomReducer, initialRoomState } from './roomReducer';
import { useAuth } from './AuthContext';
import { loadIdentity, saveIdentity } from './useIdentitySession';
import { useScreenShare } from '../features/sharing/useScreenShare';
import { useCamera } from '../features/sharing/useCamera';
import { useMicrophone } from '../features/sharing/useMicrophone';
import { useTrackSpeaking } from '../features/sharing/useLiveKitTrack';
import type { TileKind } from '../features/sharing/tileTypes';
import { loadShowStats, saveShowStats, loadNotifyVolume, saveNotifyVolume } from '../features/settings/useSettingsPreference';
import { playSound, preloadSounds, setVolume } from '../shared/sounds';
import { uploadWithProgress } from '../shared/lib/uploadWithProgress';
import { uploadFileInChunks } from '../shared/lib/chunkedUpload';
import type { Category, ChatMessage, ClientMessage, Participant, PublicUser, ReactionEmoji, ServerMessage, StorageUsage } from '../types/protocol';

const REACTION_DURATION_MS = 3000; // must match --animate-float-up in index.css
const CHAT_CLIENT_LIMIT = 300; // client-side cap only — server already limits history sent on welcome
const VOICE_TOKEN_TIMEOUT_MS = 15000;
// How long a sent-but-unconfirmed message waits before showing as failed —
// generous enough to absorb normal latency, but short enough that a
// silently-rejected send (e.g. the channel was deleted mid-flight) doesn't
// leave "Enviando..." up indefinitely. Never fires while offline (see
// armChatSendTimeout) — that's a queued send, not a failure.
const CHAT_SEND_TIMEOUT_MS = 12000;

const IDLE_VOICE_CONNECTION: VoiceConnectionState = {
  status: 'idle',
  channelId: null,
  mode: 'voice',
  joinMuted: true,
  error: null,
};

/** Syncs allUsers (account directory) with a participant's current avatar/
 * role — otherwise avatar changes only reached other users' sidebars after
 * a reload. */
function mergeUserFromParticipant(prev: Map<string, PublicUser>, participant: Participant): Map<string, PublicUser> {
  const existing = prev.get(participant.userId);
  if (!existing || (existing.avatar === participant.avatar && existing.role === participant.role)) return prev;
  const next = new Map(prev);
  next.set(participant.userId, { ...existing, avatar: participant.avatar, role: participant.role });
  return next;
}

export function RoomProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(roomReducer, initialRoomState);
  const auth = useAuth();

  const socketRef = useRef<Socket | null>(null);
  const myIdRef = useRef<string | null>(null);
  const myUserIdRef = useRef<string | null>(null);
  const tokenRef = useRef<string | null>(null);
  const intentionalCloseRef = useRef(false);
  // A server-initiated Socket.IO disconnect does not auto-reconnect. Keep
  // session expiry separate: it must return to login instead of showing an
  // endless reconnect banner or reconnecting with the same expired cookie.
  const sessionExpiredRef = useRef(false);
  const tileDomRegistry = useRef<Map<string, TileDomHandle>>(new Map());
  const audioRegistry = useRef<Map<string, AudioHandle>>(new Map());

  // browsers block autoplay-with-sound until a user gesture; one gesture
  // unlocks it for the whole page (not per-tile), for the rest of the session.
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

  // real toggleDeafened (which also mutes the mic) is defined after
  // useMicrophone exists below.
  const [deafened, setDeafened] = useState(false);
  const deafenedRef = useRef(false);

  const [livekitRoom] = useState(() => new Room());

  const [showStats, setShowStatsState] = useState(loadShowStats);
  const setShowStats = useCallback((value: boolean) => {
    setShowStatsState(value);
    saveShowStats(value);
  }, []);

  // read via shared/sounds.ts#setVolume, not props — also called outside
  // components (useMicrophone.ts).
  const [notifyVolume, setNotifyVolumeState] = useState(loadNotifyVolume);
  const setNotifyVolume = useCallback((value: number) => {
    setNotifyVolumeState(value);
    saveNotifyVolume(value);
    setVolume(value);
  }, []);

  // Returns whether it actually went out — callers that need to track
  // delivery (see the pending chat-send machinery below) use this to know
  // whether to arm a confirmation timeout or just leave the send queued.
  const sendWs = useCallback((msg: ClientMessage): boolean => {
    if (!socketRef.current?.connected) return false;
    socketRef.current.emit(msg.t, msg);
    return true;
  }, []);

  const [categories, setCategories] = useState<Category[]>([]);
  const [activeChannelId, setActiveChannelIdState] = useState<string | null>(null);
  // ref (not state) — handleServerMessage is registered once at mount and
  // would otherwise close over a stale activeChannelId.
  const activeChannelIdRef = useRef<string | null>(null);
  const [activeVoiceChannelId, setActiveVoiceChannelIdState] = useState<string | null>(null);
  // same staleness reason as activeChannelIdRef. pendingVoiceChannelIdRef
  // lets the 'voice-token' handler discard a stale reply if the channel was
  // switched again before it arrived.
  const activeVoiceChannelIdRef = useRef<string | null>(null);
  const pendingVoiceChannelIdRef = useRef<string | null>(null);
  const voiceJoinTimeoutRef = useRef<number | null>(null);
  const voiceJoinOptionsRef = useRef<Required<VoiceJoinOptions>>({ muted: true, listenOnly: false });
  const voiceConnectionRef = useRef<VoiceConnectionState>(IDLE_VOICE_CONNECTION);
  const [voiceConnection, setVoiceConnectionState] = useState<VoiceConnectionState>(IDLE_VOICE_CONNECTION);
  const setVoiceConnection = useCallback((next: VoiceConnectionState) => {
    voiceConnectionRef.current = next;
    setVoiceConnectionState(next);
  }, []);
  const clearVoiceJoinTimeout = useCallback(() => {
    if (voiceJoinTimeoutRef.current != null) window.clearTimeout(voiceJoinTimeoutRef.current);
    voiceJoinTimeoutRef.current = null;
  }, []);
  const setActiveVoiceChannelId = useCallback((id: string | null) => {
    activeVoiceChannelIdRef.current = id;
    setActiveVoiceChannelIdState(id);
  }, []);
  // same staleness reason — lets the new-message sound know if the user is
  // already looking at chat (view lives in Shell/App.tsx, not here).
  const activeViewRef = useRef<'chat' | 'call'>('chat');
  const notifyActiveView = useCallback((view: 'chat' | 'call') => { activeViewRef.current = view; }, []);
  const [messagesByChannel, setMessagesByChannel] = useState<Map<string, ChatMessage[]>>(new Map());
  // Bookkeeping for sends not yet confirmed by the server — the source of
  // truth for WHAT to (re)send; `pending` on the ChatMessage objects above
  // is only the rendering reflection of `status` here. A plain ref (not
  // state): everything that reads/writes it is either an event handler or
  // the mount-frozen handleServerMessage closure below, never render itself.
  const pendingChatSendsRef = useRef<Map<string, {
    channelId: string;
    text: string;
    replyToMsgId?: number;
    status: 'sending' | 'failed';
    timeoutId: number | null;
  }>>(new Map());
  // Negative, decrementing — real message ids are Postgres serials (always
  // positive), so these can never collide with a confirmed message.
  const nextOptimisticMsgIdRef = useRef(-1);
  const [unreadByChannel, setUnreadByChannel] = useState<Map<string, number>>(new Map());
  const [allUsers, setAllUsers] = useState<Map<string, PublicUser>>(new Map());
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set());
  const [storageUsage, setStorageUsage] = useState<StorageUsage>({ totalBytes: 0, totalFiles: 0, maxBytes: 0 });
  // recoverable channel-management error, distinct from state.roomError
  // (which is a full-screen blocker).
  const [channelsError, setChannelsError] = useState<string | null>(null);
  // same idea, for the Moderation tab.
  const [moderationError, setModerationError] = useState<string | null>(null);

  /** Also used internally for the first channel on join and as a fallback
   * when the open channel gets deleted. */
  const openChannel = useCallback((channelId: string) => {
    activeChannelIdRef.current = channelId;
    setActiveChannelIdState(channelId);
    setUnreadByChannel((prev) => {
      if (!prev.has(channelId)) return prev;
      const next = new Map(prev);
      next.delete(channelId);
      return next;
    });
    sendWs({ t: 'channel-open', channelId });
  }, [sendWs]);

  // Marks one pending send as failed — both in the bookkeeping map (so a
  // later reconnect flush skips it; only an explicit retry resends it) and
  // in the rendered message (so ChatMessageList can show it). A no-op if it
  // was confirmed (or already failed) in the meantime.
  const markChatSendFailed = useCallback((channelId: string, clientId: string) => {
    const pending = pendingChatSendsRef.current.get(clientId);
    if (!pending || pending.status !== 'sending') return;
    pending.status = 'failed';
    setMessagesByChannel((prev) => {
      const existing = prev.get(channelId);
      const index = existing?.findIndex((msg) => msg.clientId === clientId) ?? -1;
      if (!existing || index === -1) return prev;
      const next = [...existing];
      next[index] = { ...next[index], pending: 'failed' };
      return new Map(prev).set(channelId, next);
    });
  }, []);

  const clearChatSendTimeout = useCallback((clientId: string) => {
    const pending = pendingChatSendsRef.current.get(clientId);
    if (pending?.timeoutId != null) window.clearTimeout(pending.timeoutId);
  }, []);

  const armChatSendTimeout = useCallback((clientId: string, channelId: string) => {
    clearChatSendTimeout(clientId);
    const pending = pendingChatSendsRef.current.get(clientId);
    if (!pending) return;
    pending.timeoutId = window.setTimeout(() => {
      // Still offline when this fires means the send is correctly queued
      // for the next reconnect flush, not failed — only a confirmation
      // that never arrives WHILE CONNECTED is a real failure.
      if (socketRef.current?.connected) markChatSendFailed(channelId, clientId);
    }, CHAT_SEND_TIMEOUT_MS);
  }, [clearChatSendTimeout, markChatSendFailed]);

  // Shared by the initial send, an explicit retry, and the reconnect flush
  // — emits (or, offline, just leaves queued) whatever is recorded for this
  // clientId.
  const emitPendingChatSend = useCallback((clientId: string) => {
    const pending = pendingChatSendsRef.current.get(clientId);
    if (!pending) return;
    const sent = sendWs({
      t: 'chat', channelId: pending.channelId, text: pending.text, clientId,
      ...(pending.replyToMsgId ? { replyTo: pending.replyToMsgId } : {}),
    });
    if (sent) armChatSendTimeout(clientId, pending.channelId);
  }, [armChatSendTimeout, sendWs]);

  const sendChatMessage = useCallback((channelId: string, text: string, replyTo?: number) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const clientId = crypto.randomUUID();
    pendingChatSendsRef.current.set(clientId, { channelId, text: trimmed, replyToMsgId: replyTo, status: 'sending', timeoutId: null });
    // Optimistic bubble, shown immediately instead of waiting for the round
    // trip. `replyTo` here only carries the numeric id forward for resend —
    // the reply preview banner (name/text snippet) only appears once the
    // server confirms, same as attachments never appearing on this bubble.
    const optimistic: ChatMessage = {
      msgId: nextOptimisticMsgIdRef.current--,
      channelId,
      id: myUserIdRef.current,
      name: state.me.name,
      avatar: state.me.avatar,
      text: trimmed,
      ts: Date.now(),
      clientId,
      pending: 'sending',
    };
    setMessagesByChannel((prev) => {
      const existing = prev.get(channelId) || [];
      return new Map(prev).set(channelId, [...existing, optimistic]);
    });
    emitPendingChatSend(clientId);
  }, [emitPendingChatSend, state.me.avatar, state.me.name]);

  /** Re-sends a message stuck in `pending: 'failed'` — same clientId, so the
   * eventual confirmation still reconciles the same bubble. */
  const retryChatMessage = useCallback((channelId: string, clientId: string) => {
    const pending = pendingChatSendsRef.current.get(clientId);
    if (!pending) return;
    pending.status = 'sending';
    setMessagesByChannel((prev) => {
      const existing = prev.get(channelId);
      const index = existing?.findIndex((msg) => msg.clientId === clientId) ?? -1;
      if (!existing || index === -1) return prev;
      const next = [...existing];
      next[index] = { ...next[index], pending: 'sending' };
      return new Map(prev).set(channelId, next);
    });
    emitPendingChatSend(clientId);
  }, [emitPendingChatSend]);

  const discardFailedChatMessage = useCallback((channelId: string, clientId: string) => {
    clearChatSendTimeout(clientId);
    pendingChatSendsRef.current.delete(clientId);
    setMessagesByChannel((prev) => {
      const existing = prev.get(channelId);
      if (!existing) return prev;
      return new Map(prev).set(channelId, existing.filter((msg) => msg.clientId !== clientId));
    });
  }, [clearChatSendTimeout]);

  /** Re-emits every send still marked 'sending' — the ones a disconnect
   * interrupted before the server could reply. Called once the socket is
   * back and re-authenticated (see the 'welcome' case below). Sends already
   * marked 'failed' wait for an explicit retry — auto-resending those could
   * surprise someone who'd already decided to edit or abandon the message. */
  const flushPendingChatSends = useCallback(() => {
    for (const [clientId, pending] of pendingChatSendsRef.current) {
      if (pending.status === 'sending') emitPendingChatSend(clientId);
    }
  }, [emitPendingChatSend]);

  const deleteChatMessage = useCallback((msgId: number) => sendWs({ t: 'chat-delete', msgId }), [sendWs]);
  const editChatMessage = useCallback((msgId: number, text: string) => {
    const trimmed = text.trim();
    if (trimmed) sendWs({ t: 'chat-edit', msgId, text: trimmed });
  }, [sendWs]);
  const reactToChatMessage = useCallback((msgId: number, emoji: ReactionEmoji) => sendWs({ t: 'chat-react', msgId, emoji }), [sendWs]);

  // plain HTTP, not the websocket — raw binary avoids base64 inflate, and
  // always chunked (a 2GB body wouldn't survive most proxies, and buffering
  // it all in memory wouldn't be safe). The message itself still arrives via
  // the usual 'chat' broadcast; this just handles the upload + progress.
  const sendAttachment = useCallback((channelId: string, file: File, caption: string, onProgress?: (fraction: number) => void) => {
    return uploadFileInChunks({ channelId, file, caption, onProgress });
  }, []);

  const createCategory = useCallback((name: string) => sendWs({ t: 'category-create', name }), [sendWs]);
  const deleteCategory = useCallback((categoryId: string) => sendWs({ t: 'category-delete', categoryId }), [sendWs]);
  const renameCategory = useCallback((categoryId: string, name: string) => sendWs({ t: 'category-rename', categoryId, name }), [sendWs]);
  const createChannel = useCallback((categoryId: string, name: string, type?: 'text' | 'voice') => sendWs({ t: 'channel-create', categoryId, name, type }), [sendWs]);
  const deleteChannel = useCallback((channelId: string) => sendWs({ t: 'channel-delete', channelId }), [sendWs]);
  const renameChannel = useCallback((channelId: string, name: string) => sendWs({ t: 'channel-rename', channelId, name }), [sendWs]);
  const reorderCategories = useCallback((orderedIds: string[]) => sendWs({ t: 'categories-reorder', orderedIds }), [sendWs]);
  const reorderChannels = useCallback((categoryId: string, orderedIds: string[]) => sendWs({ t: 'channels-reorder', categoryId, orderedIds }), [sendWs]);
  const deleteUserAccount = useCallback((userId: string) => sendWs({ t: 'user-delete', userId }), [sendWs]);

  const { startSharing, stopSharing, quality, setQuality } = useScreenShare(livekitRoom, dispatch);
  const { startCamera, stopCamera } = useCamera(livekitRoom, dispatch, quality);
  const { activateMic, toggleMicMuted: toggleMicTrack, setMicMuted, leaveMic } = useMicrophone(livekitRoom, dispatch);

  const toggleMicMuted = useCallback(async () => {
    if (voiceConnectionRef.current.status !== 'connected') return;
    // Deafen must imply mute at all times, not only at the instant deafen is
    // toggled. This also closes the rapid-click race before React rerenders.
    if (deafenedRef.current) {
      await setMicMuted(true);
      dispatch({ type: 'SET_SHARE_ERROR', message: 'Volte a ouvir a chamada antes de desmutar o microfone.' });
      return;
    }
    await toggleMicTrack();
  }, [dispatch, setMicMuted, toggleMicTrack]);

  /** Promotes a connected listen-only session to normal voice. If deafen is
   * active, the track is still created muted — it must never transmit while
   * the user cannot hear the room. */
  const enableMicrophone = useCallback(async () => {
    if (voiceConnectionRef.current.status !== 'connected') return;
    const result = await activateMic({ muted: deafenedRef.current });
    if (voiceConnectionRef.current.status !== 'connected') {
      if (result.ok) await leaveMic();
      return;
    }
    if (!result.ok) {
      setVoiceConnection({ ...voiceConnectionRef.current, mode: 'listen-only' });
      dispatch({ type: 'SET_SHARE_ERROR', message: `${result.error} Voce continua conectado somente para ouvir.` });
      return;
    }
    setVoiceConnection({ ...voiceConnectionRef.current, mode: 'voice' });
    if (deafenedRef.current) {
      dispatch({ type: 'SET_SHARE_ERROR', message: 'Microfone ativado, mas mantido mutado enquanto voce estiver sem ouvir a chamada.' });
    }
  }, [activateMic, dispatch, leaveMic, setVoiceConnection]);

  // Deafening also force-mutes (otherwise others still hear you while they
  // cannot be heard). Outside a connected call it is a no-op; leaving also
  // resets it, so a later join cannot accidentally publish an unmuted mic
  // behind a stale "deafened" indicator.
  const toggleDeafened = useCallback(() => {
    if (voiceConnectionRef.current.status !== 'connected') return;
    // read directly, not the setState updater form — needed outside the
    // updater to play the sound once; the updater form re-runs in dev
    // StrictMode and would double it.
    const next = !deafenedRef.current;
    deafenedRef.current = next;
    setDeafened(next);
    if (next) setMicMuted(true);
    playSound(next ? 'deafened' : 'undeafened');
    // no LiveKit track equivalent for deafened — must announce it
    // explicitly so others can show the icon.
    sendWs({ t: 'deafened', value: next });
  }, [setMicMuted, sendWs]);

  const leaveVoiceChannel = useCallback(async () => {
    const hadVoiceSession = voiceConnectionRef.current.status !== 'idle'
      || activeVoiceChannelIdRef.current !== null
      || pendingVoiceChannelIdRef.current !== null;
    // Capture this now. If this leave was triggered because Socket.IO is
    // already down, a later reconnect must not receive a stale voice-leave.
    const shouldNotifyServer = hadVoiceSession && !!socketRef.current?.connected;
    clearVoiceJoinTimeout();
    pendingVoiceChannelIdRef.current = null;
    // Set this before disconnect(): RoomEvent.Disconnected must not turn an
    // intentional leave into a visible failure.
    setVoiceConnection({ ...IDLE_VOICE_CONNECTION });
    if (state.me.cameraOn) stopCamera();
    if (state.me.sharing) stopSharing();
    // Disconnect synchronously before waiting on any track cleanup. This is
    // important for server-forced socket disconnects (logout in another tab):
    // no camera/mic/audio should linger during the authentication retry.
    livekitRoom.disconnect();
    try { await leaveMic(); } catch { /* disconnect already stopped local tracks */ }
    if (shouldNotifyServer) sendWs({ t: 'voice-leave' });
    setActiveVoiceChannelId(null);
    deafenedRef.current = false;
    setDeafened(false);
    dispatch({ type: 'SET_SHARE_ERROR', message: null });
  }, [clearVoiceJoinTimeout, dispatch, state.me.cameraOn, state.me.sharing, stopCamera, stopSharing, leaveMic, livekitRoom, sendWs, setActiveVoiceChannelId, setVoiceConnection]);

  // only one voice channel at a time — leaves the current one first if
  // switching. Connect + mic activation continue in the 'voice-token' case
  // in handleServerMessage below.
  const joinVoiceChannel = useCallback(async (channelId: string, options: VoiceJoinOptions = {}) => {
    const current = voiceConnectionRef.current;
    if (current.status === 'connected' && current.channelId === channelId) return;
    if (current.status === 'joining' && current.channelId === channelId) return;
    if (current.status !== 'idle' || activeVoiceChannelIdRef.current) await leaveVoiceChannel();

    const normalized = { muted: options.muted ?? true, listenOnly: options.listenOnly ?? false };
    voiceJoinOptionsRef.current = normalized;
    dispatch({ type: 'SET_SHARE_ERROR', message: null });
    if (!socketRef.current?.connected) {
      setVoiceConnection({
        status: 'failed', channelId, mode: normalized.listenOnly ? 'listen-only' : 'voice',
        joinMuted: normalized.muted, error: 'Sem conexao com o servidor. Aguarde a reconexao e tente novamente.',
      });
      return;
    }

    pendingVoiceChannelIdRef.current = channelId;
    setVoiceConnection({
      status: 'joining', channelId, mode: normalized.listenOnly ? 'listen-only' : 'voice',
      joinMuted: normalized.muted, error: null,
    });
    sendWs({ t: 'voice-join', channelId });
    clearVoiceJoinTimeout();
    voiceJoinTimeoutRef.current = window.setTimeout(() => {
      if (pendingVoiceChannelIdRef.current !== channelId || voiceConnectionRef.current.status !== 'joining') return;
      pendingVoiceChannelIdRef.current = null;
      sendWs({ t: 'voice-leave' });
      setVoiceConnection({
        status: 'failed', channelId, mode: normalized.listenOnly ? 'listen-only' : 'voice',
        joinMuted: normalized.muted, error: 'O servidor de voz demorou demais para responder.',
      });
    }, VOICE_TOKEN_TIMEOUT_MS);
  }, [clearVoiceJoinTimeout, dispatch, leaveVoiceChannel, sendWs, setVoiceConnection]);

  const retryVoiceChannel = useCallback(() => {
    const current = voiceConnectionRef.current;
    if (current.status !== 'failed' || !current.channelId) return;
    void joinVoiceChannel(current.channelId, {
      muted: current.joinMuted,
      listenOnly: current.mode === 'listen-only',
    });
  }, [joinVoiceChannel]);

  const cancelVoiceJoin = leaveVoiceChannel;

  // leaveVoiceChannel's identity changes with cameraOn/sharing, but it's
  // called from the mount-only handleServerMessage closure below — without
  // this ref it would run with stale (always-false) values.
  const leaveVoiceChannelRef = useRef(leaveVoiceChannel);
  useEffect(() => { leaveVoiceChannelRef.current = leaveVoiceChannel; }, [leaveVoiceChannel]);

  const connectVoiceChannel = useCallback(async (channelId: string, livekitUrl: string, livekitToken: string) => {
    clearVoiceJoinTimeout();
    if (pendingVoiceChannelIdRef.current !== channelId) return;
    const options = voiceJoinOptionsRef.current;

    try {
      await livekitRoom.connect(livekitUrl, livekitToken);
    } catch (err) {
      if (pendingVoiceChannelIdRef.current !== channelId) return;
      pendingVoiceChannelIdRef.current = null;
      livekitRoom.disconnect();
      sendWs({ t: 'voice-leave' });
      setActiveVoiceChannelId(null);
      setVoiceConnection({
        status: 'failed',
        channelId,
        mode: options.listenOnly ? 'listen-only' : 'voice',
        joinMuted: options.muted,
        error: `Nao foi possivel conectar a chamada: ${(err as Error)?.message || 'verifique sua conexao.'}`,
      });
      return;
    }

    // Cancel/switch may happen while connect() or the browser permission
    // prompt is pending. Never resurrect a stale attempt.
    if (pendingVoiceChannelIdRef.current !== channelId) {
      livekitRoom.disconnect();
      return;
    }

    let mode: VoiceConnectionState['mode'] = options.listenOnly ? 'listen-only' : 'voice';
    if (!options.listenOnly) {
      const micResult = await activateMic({ muted: options.muted });
      if (pendingVoiceChannelIdRef.current !== channelId) {
        if (micResult.ok) await leaveMic();
        livekitRoom.disconnect();
        return;
      }
      if (!micResult.ok) {
        mode = 'listen-only';
        dispatch({ type: 'SET_SHARE_ERROR', message: `${micResult.error} Voce entrou somente para ouvir.` });
      }
    }

    pendingVoiceChannelIdRef.current = null;
    setActiveVoiceChannelId(channelId);
    setVoiceConnection({
      status: 'connected',
      channelId,
      mode,
      joinMuted: options.muted,
      error: null,
    });
  }, [activateMic, clearVoiceJoinTimeout, dispatch, leaveMic, livekitRoom, sendWs, setActiveVoiceChannelId, setVoiceConnection]);

  // LiveKit retries transient transport failures internally. A final
  // Disconnected event, however, needs a recoverable UI instead of silently
  // leaving an empty black stage.
  useEffect(() => {
    const onDisconnected = () => {
      const current = voiceConnectionRef.current;
      if (current.status !== 'connected') return;
      clearVoiceJoinTimeout();
      pendingVoiceChannelIdRef.current = null;
      sendWs({ t: 'voice-leave' });
      setActiveVoiceChannelId(null);
      deafenedRef.current = false;
      setDeafened(false);
      dispatch({ type: 'SET_LOCAL_CAMERA', on: false });
      dispatch({ type: 'SET_LOCAL_SHARING', sharing: false });
      setVoiceConnection({
        ...current,
        status: 'failed',
        error: 'A conexao de voz foi encerrada. Tente entrar novamente.',
      });
    };
    livekitRoom.on(RoomEvent.Disconnected, onDisconnected);
    return () => { livekitRoom.off(RoomEvent.Disconnected, onDisconnected); };
  }, [clearVoiceJoinTimeout, dispatch, livekitRoom, sendWs, setActiveVoiceChannelId, setVoiceConnection]);

  // syncs state when camera/screen stop via the browser's native controls
  // (e.g. Chrome's "Stop sharing" button) — LiveKit already unpublishes the
  // track, this just reflects it in the reducer. Mic doesn't need this:
  // its state is always read live from LiveKit (useParticipantMedia).
  useEffect(() => {
    const onLocalUnpublished = (pub: LocalTrackPublication) => {
      if (pub.source === Track.Source.ScreenShare) dispatch({ type: 'SET_LOCAL_SHARING', sharing: false });
      if (pub.source === Track.Source.Camera) dispatch({ type: 'SET_LOCAL_CAMERA', on: false });
    };
    livekitRoom.on(RoomEvent.LocalTrackUnpublished, onLocalUnpublished);
    return () => { livekitRoom.off(RoomEvent.LocalTrackUnpublished, onLocalUnpublished); };
  }, [livekitRoom, dispatch]);

  // Track*/LocalTrack* events together cover both remote and local join/
  // leave sounds — mic uses join/leave sounds, screen/camera only get a
  // start sound (stopping stays silent).
  useEffect(() => {
    const onPublished = (pub: { source: Track.Source }) => {
      if (pub.source === Track.Source.Microphone) playSound('incomingUser');
      if (pub.source === Track.Source.ScreenShare) playSound('screenshare');
      if (pub.source === Track.Source.Camera) playSound('camera');
    };
    // only MY publish reports the Discord webhook — the server has no
    // visibility into who's in the call/sharing (that lives in LiveKit only).
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

  // self-reports my own mic/camera/screen state to the server via
  // Socket.IO — the ONLY way anyone NOT connected to my current voice
  // channel's LiveKit room can know whether I'm muted, on camera, or
  // sharing (LiveKit only tells people already in that specific room, see
  // ChannelTree.tsx#CallParticipantRow). Also keeps the mic track/muted
  // state in plain React state here, since RoomProvider PROVIDES useRoom()'s
  // context and so can't consume useParticipantMedia/useIsSpeaking itself
  // (needed below to detect and report 'speaking' the same way).
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
    // TrackMuted/Unmuted fire for ANY participant — filtered to my own
    // publication, the only one I should be reporting.
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

  // 'speaking' is detected 100% locally (see useTrackSpeaking) — this only
  // reports the already-debounced on/off transitions, not a continuous stream.
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
        tokenRef.current = m.token;
        saveIdentity(m.id, m.token);
        dispatch({ type: 'WELCOME', id: m.id, userId: m.userId, name: m.name, avatar: m.avatar, role: m.role, participants: m.participants });
        setCategories(m.categories);
        setAllUsers(new Map(m.users.map((u) => [u.id, u])));
        setOnlineUserIds(new Set(m.onlineUserIds));
        setStorageUsage(m.storageUsage);
        {
          // first TEXT channel becomes active on join (skip a voice channel
          // if it comes first in the tree — opening it wouldn't make sense).
          const firstChannel = m.categories.flatMap((cat) => cat.channels).find((ch) => ch.type === 'text');
          if (firstChannel) openChannel(firstChannel.id);
        }
        // does NOT connect to LiveKit here — just having the tab open
        // shouldn't open a real voice session. That only happens in
        // joinVoiceChannel (see 'voice-token' below).
        // Re-sends whatever a previous disconnect interrupted mid-flight.
        // Harmless (a no-op loop over an empty map) on the very first join.
        flushPendingChatSends();
        break;
      }
      case 'voice-token': {
        // race: a second voice-join (fast channel switch) can reply out of
        // order — only apply if this is still the most recent request.
        if (m.channelId !== pendingVoiceChannelIdRef.current) break;
        void connectVoiceChannel(m.channelId, m.livekitUrl, m.livekitToken);
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
      case 'channel-history':
        setMessagesByChannel((prev) => {
          // A still-unconfirmed local send has no row in the server's
          // history yet — keep it, appended after the real history, instead
          // of letting a channel-open refresh (switching tabs away and back,
          // or the automatic re-open on reconnect above) silently erase it.
          const stillPending = (prev.get(m.channelId) || []).filter((msg) => msg.pending);
          const messages = stillPending.length ? [...m.messages, ...stillPending] : m.messages;
          return new Map(prev).set(m.channelId, messages);
        });
        break;
      case 'chat': {
        const channelId = m.message.channelId;
        const amLookingAtIt = document.hasFocus() && activeViewRef.current === 'chat' && channelId === activeChannelIdRef.current;
        const confirmedClientId = m.message.clientId;
        if (confirmedClientId) {
          // Own optimistic bubble confirmed — stop tracking it as pending
          // and swap it in place for the real (server-assigned id, possibly
          // server-rewritten reply preview) message, instead of appending a
          // second copy.
          clearChatSendTimeout(confirmedClientId);
          pendingChatSendsRef.current.delete(confirmedClientId);
        }
        setMessagesByChannel((prev) => {
          const existing = prev.get(channelId) || [];
          const pendingIndex = confirmedClientId ? existing.findIndex((msg) => msg.clientId === confirmedClientId) : -1;
          const next = pendingIndex === -1 ? [...existing, m.message] : existing.with(pendingIndex, m.message);
          return new Map(prev).set(channelId, next.length > CHAT_CLIENT_LIMIT ? next.slice(next.length - CHAT_CLIENT_LIMIT) : next);
        });
        // The selected text channel remains selected while the call view is
        // open. It is only "read" when that exact chat is actually visible
        // and the document has focus.
        if (!amLookingAtIt) {
          setUnreadByChannel((prev) => new Map(prev).set(channelId, (prev.get(channelId) || 0) + 1));
        }
        // skip the sound for my own messages (echoed back) and when I'm
        // already looking at this exact channel.
        if (m.message.id !== myUserIdRef.current && !amLookingAtIt) playSound('newMessage');
        break;
      }
      case 'chat-deleted':
        setMessagesByChannel((prev) => {
          const existing = prev.get(m.channelId);
          if (!existing) return prev;
          return new Map(prev).set(m.channelId, existing.filter((msg) => msg.msgId !== m.msgId));
        });
        break;
      case 'chat-edited': {
        const channelId = m.message.channelId;
        setMessagesByChannel((prev) => {
          const existing = prev.get(channelId);
          if (!existing) return prev;
          return new Map(prev).set(channelId, existing.map((msg) => (msg.msgId === m.message.msgId ? m.message : msg)));
        });
        break;
      }
      case 'chat-reaction-updated':
        setMessagesByChannel((prev) => {
          const existing = prev.get(m.channelId);
          if (!existing) return prev;
          const next = existing.map((msg) => {
            if (msg.msgId !== m.msgId) return msg;
            const reactions = { ...msg.reactions };
            if (m.userIds.length) reactions[m.emoji] = m.userIds; else delete reactions[m.emoji];
            return { ...msg, reactions };
          });
          return new Map(prev).set(m.channelId, next);
        });
        break;
      case 'channels-tree': {
        setCategories(m.categories);
        const stillExists = m.categories.some((cat) => cat.channels.some((ch) => ch.id === activeChannelIdRef.current));
        if (!stillExists) {
          const fallback = m.categories.flatMap((cat) => cat.channels).find((ch) => ch.type === 'text');
          if (fallback) openChannel(fallback.id);
          else { activeChannelIdRef.current = null; setActiveChannelIdState(null); }
        }
        break;
      }
      case 'channel-deleted':
        setMessagesByChannel((prev) => {
          if (!prev.has(m.channelId)) return prev;
          const next = new Map(prev);
          next.delete(m.channelId);
          return next;
        });
        setUnreadByChannel((prev) => {
          if (!prev.has(m.channelId)) return prev;
          const next = new Map(prev);
          next.delete(m.channelId);
          return next;
        });
        // voice channel deleted while I was in it — server already cleared
        // my voiceChannelId, this just tears down the local Room/mic/camera/screen.
        if (m.channelId === activeVoiceChannelIdRef.current) leaveVoiceChannelRef.current();
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
        if (m.code === 'session-expired') {
          sessionExpiredRef.current = true;
          dispatch({ type: 'SET_RECONNECTING', value: false });
          // Stop WebRTC immediately while /api/auth/me confirms the expired
          // session and AuthGate returns to the login screen.
          void leaveVoiceChannelRef.current();
          void auth.refresh();
        } else if (m.code === 'join-timeout') {
          // The following `io server disconnect` is not auto-retried by the
          // Socket.IO client. Its disconnect handler reconnects explicitly;
          // show honest status during that short retry.
          dispatch({ type: 'SET_RECONNECTING', value: true });
        } else if (m.code === 'full') {
          intentionalCloseRef.current = true;
          try { socketRef.current?.disconnect(); } catch { /* ok */ }
          dispatch({ type: 'SET_ROOM_ERROR', message: m.message || 'Sala cheia, tente mais tarde.' });
        } else if (m.code === 'category-not-empty' || m.code === 'cannot-delete-last-voice-channel') {
          setChannelsError(m.message);
        } else if (m.code === 'cannot-delete-self') {
          setModerationError(m.message);
        } else if (m.code === 'livekit-unavailable') {
          clearVoiceJoinTimeout();
          const channelId = pendingVoiceChannelIdRef.current ?? voiceConnectionRef.current.channelId;
          const options = voiceJoinOptionsRef.current;
          pendingVoiceChannelIdRef.current = null;
          setActiveVoiceChannelId(null);
          setVoiceConnection({
            status: 'failed',
            channelId,
            mode: options.listenOnly ? 'listen-only' : 'voice',
            joinMuted: options.muted,
            error: m.message,
          });
        } else {
          // unknown code — log it instead of failing silently (happened
          // before with this handler).
          console.warn('[ws] erro nao tratado do servidor:', m.code, m.message);
        }
        break;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearChatSendTimeout, clearVoiceJoinTimeout, connectVoiceChannel, dispatch, flushPendingChatSends, openChannel, pushReaction, setActiveVoiceChannelId, setVoiceConnection]);

  const connect = useCallback(() => {
    intentionalCloseRef.current = false;
    // withCredentials: the handshake must carry the session cookie —
    // io.use on the server rejects any connection without it.
    const socket = io(location.origin, { path: '/ws', transports: ['websocket'], withCredentials: true });
    socketRef.current = socket;

    socket.on('connect', () => {
      const saved = loadIdentity();
      sendWs({ t: 'join', id: saved?.id, token: saved?.token });
    });

    socket.onAny((_eventName: string, payload: ServerMessage) => handleServerMessage(payload));

    socket.on('disconnect', (reason) => {
      if (intentionalCloseRef.current) return;
      if (sessionExpiredRef.current) {
        dispatch({ type: 'SET_RECONNECTING', value: false });
        return;
      }
      dispatch({ type: 'SET_RECONNECTING', value: true });
      // Transport failures reconnect automatically. A server-forced
      // disconnect explicitly does not, so restart this same authenticated
      // socket and let the normal `connect` listener send `join` again. Tear
      // down LiveKit first: this path also covers logout/account deletion in
      // another tab, whose session will be rejected by the next handshake.
      if (reason === 'io server disconnect') {
        void leaveVoiceChannelRef.current();
        socket.connect();
      }
    });

    // io.use rejection (invalid/expired session) sets socket.active=false
    // and it won't auto-reconnect; auth.refresh() re-checks /api/auth/me and
    // AuthGate falls back to login if the session is truly dead.
    socket.on('connect_error', () => {
      if (!socket.active) auth.refresh();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch, sendWs, handleServerMessage, auth]);

  const updateAvatar = useCallback((avatar: string) => {
    const finalAvatar = avatar.trim().slice(0, 500);
    dispatch({ type: 'SET_LOCAL_AVATAR', avatar: finalAvatar });
    sendWs({ t: 'profile', avatar: finalAvatar });
  }, [dispatch, sendWs]);

  // same upload folder/route as chat attachments — this only gets the URL
  // back; updateAvatar (shared with pasting an external URL) applies it.
  const uploadAvatarFile = useCallback(async (file: File, onProgress?: (fraction: number) => void) => {
    const body = await uploadWithProgress<{ avatar: string }>({
      url: '/api/avatar',
      file,
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      onProgress,
    });
    updateAvatar(body.avatar);
    return body.avatar;
  }, [updateAvatar]);

  // menuOpenRef exists so closeTileMenu can answer synchronously whether it
  // actually closed something (setState isn't synchronous enough for that).
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

  // connect once on mount — RoomProvider only mounts once there's a valid
  // session (AuthGate), so no "am I logged in?" check needed here.
  useEffect(() => {
    preloadSounds();
    setVolume(notifyVolume);
    connect();
    return () => {
      clearVoiceJoinTimeout();
      intentionalCloseRef.current = true;
      socketRef.current?.disconnect();
      livekitRoom.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <RoomContext.Provider
      value={{
        state, dispatch, sendWs, tileDomRegistry, audioRegistry, audioUnlocked, deafened, toggleDeafened, livekitRoom, notifyActiveView,
        activeVoiceChannelId, voiceConnection, joinVoiceChannel, retryVoiceChannel, cancelVoiceJoin,
        startSharing, stopSharing, startCamera, stopCamera, enableMicrophone, toggleMicMuted, leaveVoiceChannel, quality, setQuality,
        updateAvatar, uploadAvatarFile, menuTarget, openTileMenu, closeTileMenu,
        reactions, sendReaction, showStats, setShowStats, notifyVolume, setNotifyVolume,
        categories, activeChannelId, openChannel, messagesByChannel, unreadByChannel,
        allUsers, onlineUserIds, channelsError, clearChannelsError: () => setChannelsError(null),
        deleteUserAccount, moderationError, clearModerationError: () => setModerationError(null),
        sendChatMessage, retryChatMessage, discardFailedChatMessage, deleteChatMessage, editChatMessage, reactToChatMessage,
        storageUsage, sendAttachment,
        createCategory, deleteCategory, renameCategory, createChannel, deleteChannel, renameChannel, reorderCategories, reorderChannels,
      }}
    >
      {children}
    </RoomContext.Provider>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch } from 'react';
import { DisconnectReason, RoomEvent, Track } from 'livekit-client';
import type { Room } from 'livekit-client';
import type { LocalTrackPublication, Track as LKTrack } from 'livekit-client';
import { playSound } from '@/shared/sounds';
import { useTrackSpeaking } from '@/features/calls/useLiveKitTrack';
import type { RoomAction } from '@/state/roomReducer';
import type { ClientMessage } from '@/shared/types/protocol';

interface CallLifecycleDeps {
  livekitRoom: Room;
  dispatch: Dispatch<RoomAction>;
  sendWs: (msg: ClientMessage) => void;
  stopCamera: () => void;
  stopSharing: () => void;
  activateMic: () => Promise<void>;
  setMicMuted: (muted: boolean) => Promise<void>;
  leaveMic: () => Promise<void>;
  cameraOn: boolean;
  sharing: boolean;
}

/** Everything about being connected to a LiveKit call: join/leave/kick,
 * deafened/audio-unlock state, and reporting our own local media state
 * (mic/camera/screen-share/speaking) back over the websocket whenever
 * LiveKit's own events say it changed. Takes `livekitRoom` as a parameter
 * (rather than creating it) because the camera/screen-share/mic hooks this
 * one composes ALSO take it as their own first argument — RoomProvider
 * creates the single `Room` instance and threads it through all of them,
 * this hook included, in the same call. */
export function useCallLifecycle(deps: CallLifecycleDeps) {
  const { livekitRoom, dispatch, sendWs, stopCamera, stopSharing, activateMic, setMicMuted, leaveMic, cameraOn, sharing } = deps;

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

  // LiveKit retries the connection on its own on a network hiccup — this just
  // surfaces that it's happening, distinct from RoomEvent.Disconnected below
  // (which means the retry gave up, or we hung up on purpose).
  const [reconnecting, setReconnecting] = useState(false);
  useEffect(() => {
    const onReconnecting = () => setReconnecting(true);
    const onReconnected = () => setReconnecting(false);
    livekitRoom.on(RoomEvent.Reconnecting, onReconnecting);
    livekitRoom.on(RoomEvent.Reconnected, onReconnected);
    livekitRoom.on(RoomEvent.Disconnected, onReconnected);
    return () => {
      livekitRoom.off(RoomEvent.Reconnecting, onReconnecting);
      livekitRoom.off(RoomEvent.Reconnected, onReconnected);
      livekitRoom.off(RoomEvent.Disconnected, onReconnected);
    };
  }, [livekitRoom]);

  const [activeCallConversationId, setActiveCallConversationIdState] = useState<string | null>(null);
  const activeCallConversationIdRef = useRef<string | null>(null);
  const pendingCallConversationIdRef = useRef<string | null>(null);
  const setActiveCallConversationId = useCallback((id: string | null) => {
    activeCallConversationIdRef.current = id;
    setActiveCallConversationIdState(id);
  }, []);

  const toggleDeafened = useCallback(() => {
    const next = !deafened;
    setDeafened(next);
    if (next) setMicMuted(true);
    playSound(next ? 'deafened' : 'undeafened');
    sendWs({ t: 'deafened', value: next });
  }, [deafened, setMicMuted, sendWs]);

  const leaveCall = useCallback(async () => {
    if (cameraOn) stopCamera();
    if (sharing) stopSharing();
    await leaveMic();
    livekitRoom.disconnect();
    sendWs({ t: 'call-leave' });
    pendingCallConversationIdRef.current = null;
    setActiveCallConversationId(null);
  }, [cameraOn, sharing, stopCamera, stopSharing, leaveMic, livekitRoom, sendWs, setActiveCallConversationId]);

  const joinCall = useCallback(async (conversationId: string) => {
    if (activeCallConversationIdRef.current === conversationId) return;
    if (activeCallConversationIdRef.current) await leaveCall();
    pendingCallConversationIdRef.current = conversationId;
    sendWs({ t: 'call-join', conversationId });
  }, [sendWs, leaveCall]);

  const leaveCallRef = useRef(leaveCall);
  useEffect(() => { leaveCallRef.current = leaveCall; }, [leaveCall]);

  const kickFromCall = useCallback((participantId: string) => sendWs({ t: 'call-kick', participantId }), [sendWs]);

  const onCallToken = useCallback((m: { conversationId: string; livekitUrl: string; livekitToken: string }) => {
    if (m.conversationId !== pendingCallConversationIdRef.current) return;
    livekitRoom.connect(m.livekitUrl, m.livekitToken)
      .then(() => activateMic())
      .catch((err) => console.warn('LiveKit connect failed', err));
    setActiveCallConversationId(m.conversationId);
  }, [livekitRoom, activateMic, setActiveCallConversationId]);

  /** If a conversation currently in a call gets deleted out from under us
   * (admin action), leave it — same as clicking "leave call" ourselves. */
  const onConversationDeleted = useCallback((conversationId: string) => {
    if (conversationId === activeCallConversationIdRef.current) leaveCallRef.current();
  }, []);

  /** The server rejected our call-join attempt (LiveKit down/misconfigured)
   * — clears the pending join so a stale call-token arriving late can't be
   * mistaken for this failed attempt. */
  const onLivekitUnavailable = useCallback(() => {
    pendingCallConversationIdRef.current = null;
  }, []);

  useEffect(() => {
    const onDisconnected = (reason?: DisconnectReason) => {
      if (reason === DisconnectReason.CLIENT_INITIATED) return;
      if (cameraOn) stopCamera();
      if (sharing) stopSharing();
      setActiveCallConversationId(null);
    };
    livekitRoom.on(RoomEvent.Disconnected, onDisconnected);
    return () => { livekitRoom.off(RoomEvent.Disconnected, onDisconnected); };
  }, [livekitRoom, stopCamera, stopSharing, setActiveCallConversationId, cameraOn, sharing]);

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

  return {
    audioUnlocked, deafened, toggleDeafened, reconnecting,
    activeCallConversationId, joinCall, leaveCall, kickFromCall,
    onCallToken, onConversationDeleted, onLivekitUnavailable,
  };
}

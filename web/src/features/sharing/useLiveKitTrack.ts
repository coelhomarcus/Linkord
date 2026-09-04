import { useEffect, useState } from 'react';
import type { RefObject } from 'react';
import { RoomEvent, Track } from 'livekit-client';
import type { Participant, Room, Track as LKTrack } from 'livekit-client';

import { useRoom } from '../../state/RoomContext';

export interface ParticipantMedia {
  screenTrack: LKTrack | null;
  screenAudioTrack: LKTrack | null;
  cameraTrack: LKTrack | null;
  micTrack: LKTrack | null;
  /** true assim que o mic foi ativado nesta sessao (publicado) — fica true
   * mesmo mudo, ja que mutar so desliga o audio, nao despublica. */
  micActivated: boolean;
  micMuted: boolean;
}

const EMPTY_MEDIA: ParticipantMedia = {
  screenTrack: null, screenAudioTrack: null, cameraTrack: null, micTrack: null,
  micActivated: false, micMuted: true,
};

/** Acha o Participant (local ou remoto) correspondente a uma identity — a
 * mesma logica usada por useParticipantMedia e useCallTiles. */
export function getParticipant(room: Room, identity: string): Participant | undefined {
  return room.localParticipant.identity === identity ? room.localParticipant : room.getParticipantByIdentity(identity);
}

/** Track "ativa" — publication existe E nao esta mutada. Mutar video
 * (camera/tela) para o hardware de verdade (diferente de mutar audio de
 * mic, que so desliga o audio sem parar nada) mas NAO despublica: a
 * publication/Track continuam existindo pra sempre depois da primeira
 * ativacao da sessao, com isMuted=true. Sem esse filtro, `!!cameraTrack`
 * ficaria true mesmo com a camera desligada, deixando um <video> preto
 * anexado a uma track parada. */
export function activeTrack(participant: Participant, source: Track.Source): LKTrack | null {
  const pub = participant.getTrackPublication(source);
  return pub && !pub.isMuted ? (pub.track ?? null) : null;
}

function readMedia(room: Room, identity: string): ParticipantMedia {
  const participant = getParticipant(room, identity);
  if (!participant) return EMPTY_MEDIA;
  const micPub = participant.getTrackPublication(Track.Source.Microphone);
  return {
    screenTrack: activeTrack(participant, Track.Source.ScreenShare),
    screenAudioTrack: activeTrack(participant, Track.Source.ScreenShareAudio),
    cameraTrack: activeTrack(participant, Track.Source.Camera),
    // micTrack fica cru (nao filtra por isMuted) de proposito — o audio
    // element em ParticipantAudioLayer precisa continuar anexado mesmo
    // mudo, pronto pra tocar na hora assim que desmutar; o "mudo" do mic ja
    // e expresso a parte via micMuted, nao escondendo a track.
    micTrack: micPub?.track ?? null,
    micActivated: !!micPub,
    micMuted: micPub ? micPub.isMuted : true,
  };
}

const MEDIA_EVENTS = [
  // TrackPublished/Unpublished disparam assim que alguem publica/despublica,
  // MESMO sem eu ter me inscrito na track — sem eles, meu proprio estado so
  // "descobria" que um participante remoto tinha ativado o mic por acidente,
  // quando algum OUTRO evento (ex: eu mesma ativando o mic, LocalTrackPublished)
  // disparava um refresh de bandeja. TrackSubscribed/Unsubscribed continuam
  // aqui tambem, pra saber quando a TRACK em si (nao so a publicacao) fica
  // disponivel pra tocar/anexar.
  RoomEvent.TrackPublished,
  RoomEvent.TrackUnpublished,
  RoomEvent.TrackSubscribed,
  RoomEvent.TrackUnsubscribed,
  RoomEvent.LocalTrackPublished,
  RoomEvent.LocalTrackUnpublished,
  RoomEvent.TrackMuted,
  RoomEvent.TrackUnmuted,
  RoomEvent.ParticipantConnected,
  RoomEvent.ParticipantDisconnected,
];

/** Le quais tracks (tela/camera/mic) um participante (local ou remoto) tem
 * publicadas agora, e se o mic esta mudo — LiveKit e a unica fonte de
 * verdade disso, nao ha nada guardado a parte no reducer. Um hook so pro
 * participante inteiro (nao um por Track.Source) porque quem monta a lista
 * de tiles (useCallTiles) e o proprio Tile precisam ver tela e camera
 * juntas pra decidir quantos retangulos essa pessoa ocupa. */
export function useParticipantMedia(identity: string): ParticipantMedia {
  const { livekitRoom } = useRoom();
  const [media, setMedia] = useState<ParticipantMedia>(EMPTY_MEDIA);

  useEffect(() => {
    const refresh = () => setMedia(readMedia(livekitRoom, identity));
    refresh();
    for (const ev of MEDIA_EVENTS) livekitRoom.on(ev, refresh);
    return () => { for (const ev of MEDIA_EVENTS) livekitRoom.off(ev, refresh); };
  }, [livekitRoom, identity]);

  return media;
}

// RMS 0..1 — ponto de partida razoavel, pode precisar de ajuste fino depois
// de testar com microfone de verdade (mais sensivel = menor; menos = maior).
const SPEAKING_THRESHOLD = 0.02;
// segura a borda por um instante depois de cair abaixo do limiar, pra nao
// piscar a cada pausa curta entre palavras — so a subida e instantanea.
const SPEAKING_RELEASE_MS = 250;

// um AudioContext so pro app inteiro (nao um por tile) — Web Audio so LE a
// track, nao "consome" ela, entao a mesma track alimenta isso e o
// <audio>/<video> que ja a usa em paralelo sem conflito nenhum.
let sharedAudioContext: AudioContext | null = null;
function getAudioContext(): AudioContext {
  if (!sharedAudioContext) sharedAudioContext = new AudioContext();
  return sharedAudioContext;
}

/** Se um participante esta falando agora. Antes isso vinha de
 * RoomEvent.ActiveSpeakersChanged — mas esse evento nao e calculado no
 * navegador, e sim empurrado periodicamente pelo SERVIDOR do LiveKit via
 * sinalizacao, o que causava um atraso perceptivel entre comecar a falar e a
 * borda aparecer (fora do nosso controle, principalmente no LiveKit Cloud).
 * Aqui a deteccao roda 100% local: analisa o audio real da track via Web
 * Audio API (AnalyserNode + requestAnimationFrame), pronta em ~1 frame. */
export function useIsSpeaking(identity: string): boolean {
  const media = useParticipantMedia(identity);
  const [isSpeaking, setIsSpeaking] = useState(false);

  useEffect(() => {
    const track = media.micTrack;
    if (!track || media.micMuted) { setIsSpeaking(false); return; }
    const mediaStreamTrack = track.mediaStreamTrack;
    if (!mediaStreamTrack) return;

    const ctx = getAudioContext();
    ctx.resume().catch(() => {});
    const source = ctx.createMediaStreamSource(new MediaStream([mediaStreamTrack]));
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);

    let rafId: number;
    let lastAboveAt = 0;
    function tick() {
      analyser.getByteTimeDomainData(data);
      let sumSquares = 0;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128;
        sumSquares += v * v;
      }
      const rms = Math.sqrt(sumSquares / data.length);
      const now = performance.now();
      if (rms > SPEAKING_THRESHOLD) lastAboveAt = now;
      setIsSpeaking(now - lastAboveAt < SPEAKING_RELEASE_MS);
      rafId = requestAnimationFrame(tick);
    }
    tick();

    return () => {
      cancelAnimationFrame(rafId);
      source.disconnect();
      analyser.disconnect();
    };
  }, [media.micTrack, media.micMuted]);

  return isSpeaking;
}

/** Anexa (attach/detach) uma track do LiveKit a um elemento de video/audio —
 * o WebRTC nativo cuida do resto (jitter, adaptacao de bitrate, etc), sem
 * fila/buffer manual nenhum. */
export function useAttachTrack(track: LKTrack | null, elRef: RefObject<HTMLMediaElement | null>): void {
  useEffect(() => {
    const el = elRef.current;
    if (!el || !track) return;
    track.attach(el);
    return () => { track.detach(el); };
  }, [track, elRef]);
}

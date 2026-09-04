import { useEffect, useState } from 'react';
import { RoomEvent, Track } from 'livekit-client';
import type { Room } from 'livekit-client';
import { useRoom } from '../../state/RoomContext';
import { activeTrack, getParticipant } from './useLiveKitTrack';
import { tileKey } from './tileTypes';
import type { TileDescriptor } from './tileTypes';

function buildDescriptors(room: Room, participantIds: string[]): TileDescriptor[] {
  const out: TileDescriptor[] = [];
  for (const id of participantIds) {
    const participant = getParticipant(room, id);
    if (!participant) continue;
    // participantIds inclui todo mundo na SALA (chat/presenca), nao so quem
    // esta na chamada — sem esse filtro, qualquer um que nunca ativou o mic
    // (ou ja saiu da call de verdade, ver leaveMic) aparecia como um tile
    // avatar no palco, como se estivesse conectado. "Na call" = tem o mic
    // publicado, mesma fonte de verdade usada em App.tsx (inCall) e na
    // LeftSidebar (CallParticipantRow).
    if (!participant.getTrackPublication(Track.Source.Microphone)) continue;
    // !!track sozinho nao basta: desligar camera/tela MUTA a publication
    // (nao despublica), entao o objeto Track continua existindo pra sempre
    // depois da primeira ativacao — activeTrack ja filtra isso.
    const hasScreen = !!activeTrack(participant, Track.Source.ScreenShare);
    const hasCamera = !!activeTrack(participant, Track.Source.Camera);
    if (hasScreen) out.push({ key: tileKey(id, 'screen'), participantId: id, kind: 'screen' });
    // toda pessoa na call sempre tem exatamente UM tile "de si mesma"
    // (camera se tiver, senao avatar) — e onde mic/selo de mudo/borda de
    // fala vivem, nunca falta, mesmo compartilhando so tela.
    const selfKind = hasCamera ? 'camera' : 'avatar';
    out.push({ key: tileKey(id, selfKind), participantId: id, kind: selfKind });
  }
  return out;
}

const CALL_TILE_EVENTS = [
  // Published/Unpublished disparam assim que alguem entra/sai da call (o
  // filtro "inCall" acima depende disso) — sem eles, esse hook so
  // "descobria" que alguem entrou/saiu por acidente, quando outro evento
  // qualquer disparava um refresh (mesma causa do bug corrigido antes em
  // useLiveKitTrack.ts).
  RoomEvent.TrackPublished,
  RoomEvent.TrackUnpublished,
  RoomEvent.TrackSubscribed,
  RoomEvent.TrackUnsubscribed,
  RoomEvent.LocalTrackPublished,
  RoomEvent.LocalTrackUnpublished,
  // desligar camera/tela e um MUTE (nao despublica, ver activeTrack acima)
  // — sem escutar isso, o tile de camera nunca voltaria a virar avatar.
  RoomEvent.TrackMuted,
  RoomEvent.TrackUnmuted,
  RoomEvent.ParticipantConnected,
  RoomEvent.ParticipantDisconnected,
];

/** Monta a lista de tiles a renderizar no grid da chamada — um por FONTE de
 * midia ATIVA, nao por participante (tela e camera da mesma pessoa viram
 * dois retangulos separados, estilo Discord). Nao escuta
 * ActiveSpeakersChanged de proposito: falar nao muda QUANTOS tiles existem,
 * so precisa de destaque visual (isso e useIsSpeaking, dentro de cada
 * Tile). */
export function useCallTiles(participantIds: string[]): TileDescriptor[] {
  const { livekitRoom } = useRoom();
  const [descriptors, setDescriptors] = useState<TileDescriptor[]>([]);
  const idsKey = participantIds.join(',');

  useEffect(() => {
    const refresh = () => setDescriptors(buildDescriptors(livekitRoom, idsKey ? idsKey.split(',') : []));
    refresh();
    for (const ev of CALL_TILE_EVENTS) livekitRoom.on(ev, refresh);
    return () => { for (const ev of CALL_TILE_EVENTS) livekitRoom.off(ev, refresh); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [livekitRoom, idsKey]);

  return descriptors;
}

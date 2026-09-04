import { useEffect, useRef } from 'react';
import { useRoom } from '../../state/RoomContext';
import { useParticipantMedia, useAttachTrack } from './useLiveKitTrack';
import { loadCallVolume } from '../settings/useCallVolumePreference';

/** Dono dos elementos <audio> (mic + audio de tela) de UM participante
 * remoto — vive fora dos Tiles visuais de proposito: o tile "de si mesma"
 * dessa pessoa troca de kind (avatar↔camera) toda vez que ela liga/desliga
 * a camera, e se o <audio> morasse dentro do Tile, cada troca desmontaria/
 * remontaria o elemento. Aqui o componente so remonta se a PESSOA sair da
 * sala, nunca por causa de kind. `audioUnlocked` (RoomProvider) e global —
 * um gesto qualquer do usuario libera autoplay pra pagina inteira, entao
 * nao ha "por participante" aqui, so espera esse flag virar true. Volume
 * real (100%, setado explicitamente mais abaixo) e completamente separado
 * disso — mudo por autoplay bloqueado nao e a mesma coisa que volume baixo. */
function ParticipantAudio({ participantId }: { participantId: string }) {
  const { state, audioRegistry, audioUnlocked, deafened } = useRoom();
  const userId = state.participants.get(participantId)?.userId ?? null;
  const media = useParticipantMedia(participantId);
  const micRef = useRef<HTMLAudioElement | null>(null);
  const screenRef = useRef<HTMLAudioElement | null>(null);
  useAttachTrack(media.micTrack, micRef);
  useAttachTrack(media.screenAudioTrack, screenRef);

  useEffect(() => {
    for (const el of [micRef.current, screenRef.current]) {
      if (!el) continue;
      el.muted = !audioUnlocked || deafened;
      if (audioUnlocked && !deafened) el.play().catch(() => {});
    }
  }, [audioUnlocked, deafened, media.micTrack, media.screenAudioTrack]);

  useEffect(() => {
    const screenKey = `${participantId}:screen`;
    const micEl = micRef.current;
    const screenEl = screenRef.current;
    // volume real vem da preferencia salva por userId (default 100% se nunca
    // ajustado) — setado aqui de proposito explicito, nao implicito, ja que
    // "audio no minimo" foi exatamente a confusao que gerou um bug anterior
    // (era o bloqueio de autoplay sendo lido como volume, o volume real nunca
    // esteve baixo). userId (nao participantId) porque e o que sobrevive a
    // reconexoes/abas — ver useCallVolumePreference.ts.
    if (micEl) {
      micEl.volume = userId ? loadCallVolume(userId) : 1;
      audioRegistry.current.set(participantId, { element: micEl });
    }
    if (screenEl) {
      screenEl.volume = userId ? loadCallVolume(`${userId}:screen`) : 1;
      audioRegistry.current.set(screenKey, { element: screenEl });
    }
    return () => {
      audioRegistry.current.delete(participantId);
      audioRegistry.current.delete(screenKey);
    };
  }, [participantId, userId, audioRegistry]);

  return (
    <>
      <audio ref={micRef} autoPlay muted={!audioUnlocked || deafened} />
      <audio ref={screenRef} autoPlay muted={!audioUnlocked || deafened} />
    </>
  );
}

/** Monta um <ParticipantAudio> por participante remoto presente na sala
 * (nunca pra mim mesma — nunca tocamos nosso proprio audio de volta). Vive
 * no Shell (App.tsx), fora da aba Call — precisa sobreviver a troca pra o
 * Quadro, senao o audio de todo mundo para ao trocar de aba. */
export function ParticipantAudioLayer({ participantIds }: { participantIds: string[] }) {
  const { state } = useRoom();
  return (
    <>
      {participantIds
        .filter((id) => id !== state.me.id)
        .map((id) => <ParticipantAudio key={id} participantId={id} />)}
    </>
  );
}

import { useCallback, useRef } from 'react';
import type { Dispatch } from 'react';
import { ConnectionState, RoomEvent, Track } from 'livekit-client';
import type { Room } from 'livekit-client';
import type { RoomAction } from '../../state/roomReducer';
import { playSound } from '../../shared/sounds';

export interface MicrophoneApi {
  /** Pede permissao + publica o mic uma vez por sessao, ja desmutado.
   * Idempotente — seguro chamar de novo (ex: retry apos permissao negada,
   * ou remontagem de quem chama). */
  activateMic: () => Promise<void>;
  /** So alterna mudo/desmutado — assume que activateMic ja rodou. */
  toggleMicMuted: () => Promise<void>;
  /** Forca um estado especifico (nao alterna) — usado por "ensurdecer", que
   * precisa GARANTIR mudo ao ligar, nao alternar o que ja estava. No-op sem
   * mic ativado, mesma guarda de toggleMicMuted. */
  setMicMuted: (muted: boolean) => Promise<void>;
  /** Sai da chamada de verdade — despublica a track (setMicrophoneEnabled(false)
   * so muta, nao despublica) e para o hardware, apagando a luz do microfone.
   * Depois disso `micActivated` volta a false; ativar de novo pede o mic de
   * novo (a permissao ja concedida nao pede outro prompt do navegador). */
  leaveMic: () => Promise<void>;
}

const CONNECT_TIMEOUT_MS = 15000;

/** Espera a Room conectar, se ainda nao estiver — activateMic e chamado
 * automaticamente assim que `state.me.id` existe (Stage.tsx), mas os dois
 * vem do MESMO 'welcome': nesse instante a Room provavelmente ainda esta
 * 'connecting' (o connect() acabou de ser disparado), nao 'connected'
 * ainda. Sem isso, essa corrida faria a ativacao automatica falhar quase
 * sempre no primeiro carregamento. */
function waitForConnection(room: Room): Promise<void> {
  if (room.state === ConnectionState.Connected) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error('timeout')); }, CONNECT_TIMEOUT_MS);
    function cleanup() {
      clearTimeout(timer);
      room.off(RoomEvent.Connected, onConnected);
    }
    function onConnected() { cleanup(); resolve(); }
    room.once(RoomEvent.Connected, onConnected);
  });
}

/**
 * Mic "nativo" estilo Discord: nao e algo que se liga/desliga, e algo que
 * se ativa uma vez por sessao (na primeira visita a aba Call) e depois so
 * muta/desmuta — o hardware/getUserMedia fica vivo o tempo todo, sem novo
 * prompt de permissao. Comeca desmutado (todo mundo entra falando, sem
 * precisar desmutar manualmente). "Ativado" e "mudo" nao moram em nenhum
 * estado aqui nem no reducer — sao lidos direto do LiveKit
 * (useParticipantMedia), a mesma fonte de verdade usada pra participantes
 * remotos.
 */
export function useMicrophone(room: Room, dispatch: Dispatch<RoomAction>): MicrophoneApi {
  // guarda so contra chamar setMicrophoneEnabled duas vezes em paralelo se
  // activateMic for chamado de novo antes da primeira ativacao terminar —
  // nao e o "micActivated" que a UI usa (esse vem do LiveKit).
  const activatingRef = useRef(false);

  const activateMic = useCallback(async () => {
    if (activatingRef.current) return;
    if (room.localParticipant.getTrackPublication(Track.Source.Microphone)) return; // ja ativado
    if (!navigator.mediaDevices?.getUserMedia) {
      dispatch({ type: 'SET_SHARE_ERROR', message: 'Seu navegador nao suporta acesso ao microfone.' });
      return;
    }

    activatingRef.current = true;
    try {
      await waitForConnection(room);
      await room.localParticipant.setMicrophoneEnabled(true); // ja comeca desmutado
    } catch (err) {
      if (err instanceof Error && err.message === 'timeout') {
        dispatch({ type: 'SET_SHARE_ERROR', message: 'Nao foi possivel conectar ao servidor de video. Verifique sua conexao e tente de novo.' });
        return;
      }
      const name = (err as DOMException)?.name;
      const denied = name === 'NotAllowedError' || name === 'NotFoundError' || name === 'AbortError';
      if (!denied) dispatch({ type: 'SET_SHARE_ERROR', message: `Nao foi possivel acessar o microfone: ${(err as Error)?.message}` });
    } finally {
      activatingRef.current = false;
    }
  }, [dispatch, room]);

  const toggleMicMuted = useCallback(async () => {
    const pub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
    // sem publicacao ainda (mic nunca ativado) nao ha o que mutar/desmutar
    // aqui — sem essa guarda, `pub?.isMuted ?? true` cai no mesmo
    // setMicrophoneEnabled(true) que activateMic usa, ativando a chamada
    // de verdade so por clicar em "desmutar" fora dela.
    if (!pub) return;
    // le pub.isMuted ANTES do await — depois de resolver, a publicacao ja
    // reflete o estado NOVO, e o som tem que anunciar a mudanca que acabou
    // de acontecer (muted.isMuted==true antes = ficou desmutado agora).
    const wasMuted = pub.isMuted;
    await room.localParticipant.setMicrophoneEnabled(wasMuted);
    playSound(wasMuted ? 'unmuted' : 'muted');
  }, [room]);

  const setMicMuted = useCallback(async (muted: boolean) => {
    const pub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
    if (!pub) return;
    await room.localParticipant.setMicrophoneEnabled(!muted);
  }, [room]);

  const leaveMic = useCallback(async () => {
    const pub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
    if (pub?.track) await room.localParticipant.unpublishTrack(pub.track, true);
  }, [room]);

  return { activateMic, toggleMicMuted, setMicMuted, leaveMic };
}

import { useCallback, useState } from 'react';
import type { Dispatch } from 'react';
import { ConnectionState, Track } from 'livekit-client';
import type { Room } from 'livekit-client';
import type { RoomAction } from '../../state/roomReducer';
import { loadQuality, saveQuality, QUALITY_ENCODINGS, type Quality } from '../settings/useQualityPreference';

export interface ScreenShareApi {
  startSharing: () => Promise<void>;
  stopSharing: () => void;
  quality: Quality;
  setQuality: (q: Quality) => void;
}

/**
 * Compartilha a propria tela publicando uma track de video (e audio, quando
 * disponivel) na Room do LiveKit — WebRTC de verdade, sem gravar/enfileirar
 * nada manualmente. `room` e uma instancia unica e estavel (criada uma vez em
 * RoomProvider); so o connect() de fato acontece depois do primeiro 'welcome'.
 */
export function useScreenShare(room: Room, dispatch: Dispatch<RoomAction>): ScreenShareApi {
  const [quality, setQualityState] = useState<Quality>(loadQuality);

  const setQuality = useCallback((q: Quality) => {
    setQualityState(q);
    saveQuality(q);
  }, []);

  const startSharing = useCallback(async () => {
    if (room.state !== ConnectionState.Connected) {
      dispatch({ type: 'SET_SHARE_ERROR', message: 'Ainda conectando ao servidor de video, tente de novo em instantes.' });
      return;
    }
    if (!navigator.mediaDevices?.getDisplayMedia) {
      dispatch({ type: 'SET_SHARE_ERROR', message: 'Seu navegador nao suporta captura de tela. Use Chrome, Edge ou Firefox no computador.' });
      return;
    }
    if (!window.isSecureContext) {
      dispatch({ type: 'SET_SHARE_ERROR', message: 'Compartilhar tela exige HTTPS (ou http://localhost pra testar).' });
      return;
    }

    const audioConstraints = {
      // desligados de proposito: sao processamentos pensados pra voz de
      // microfone, e degradam audio de aba/sistema (ex. cortam musica).
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      // pede pro navegador filtrar, da captura, qualquer audio produzido
      // pela PROPRIA aba do Linkord. selfBrowserSurface (abaixo) ja tira a
      // aba da lista de "aba do navegador", mas nao cobre "tela inteira +
      // compartilhar audio do sistema" — esse modo captura o mixer do SO
      // inteiro, entao ainda pegaria a voz dos outros participantes tocando
      // na nossa propria aba. So tem efeito quando a superficie capturada
      // realmente inclui audio de sistema; navegadores sem suporte ignoram.
      restrictOwnAudio: true,
    };

    try {
      await room.localParticipant.setScreenShareEnabled(
        true,
        {
          audio: audioConstraints,
          resolution: { width: 1920, height: 1080, frameRate: 30 },
          // impede a propria aba do Linkord de aparecer no seletor de
          // compartilhamento. Sem isso, quem compartilha pode escolher a
          // aba da chamada, cujo audio (via ParticipantAudioLayer) ja inclui
          // a voz de todo mundo na call — compartilhar essa aba manda esse
          // audio de volta pro LiveKit, e cada participante ouve a propria
          // voz retornando. Nao e eco fisico de caixa de som/microfone: e a
          // MESMA aba sendo capturada e republicada, um loop de software.
          selfBrowserSurface: 'exclude',
        },
        { videoEncoding: QUALITY_ENCODINGS[quality] },
      );
    } catch (err) {
      const name = (err as DOMException)?.name;
      const aborted = name === 'NotAllowedError' || name === 'AbortError';
      if (!aborted) dispatch({ type: 'SET_SHARE_ERROR', message: `Nao foi possivel capturar a tela: ${(err as Error)?.message}` });
      return;
    }

    dispatch({ type: 'SET_LOCAL_SHARING', sharing: true });
    // essa tentativa deu certo — limpa qualquer SET_SHARE_ERROR de uma
    // tentativa ANTERIOR que tenha ficado pendurado na tela (ex.: "ainda
    // conectando", tentou nao vez, funcionou nessa).
    dispatch({ type: 'SET_SHARE_ERROR', message: null });

    // getDisplayMedia nem sempre entrega audio, e o motivo muda conforme o
    // que a pessoa escolheu no seletor do navegador (displaySurface, exposto
    // no proprio MediaStreamTrack de video que acabou de ser publicado):
    //   'window'  — JANELA nunca tem audio, em nenhum navegador/SO. Restricao
    //               universal do getDisplayMedia, sem excecao conhecida.
    //   'monitor' — TELA INTEIRA so vem com audio se a pessoa marcar
    //               "Tambem compartilhar audio do sistema" na caixa de
    //               dialogo do Chrome/Edge — e essa opcao nem aparece no
    //               macOS (o SO nao expoe loopback de audio pro navegador
    //               fora do mixer interno de abas).
    //   'browser' — ABA do navegador: unico modo com audio garantido em
    //               qualquer sistema (captura o mixer interno da aba, nao
    //               depende de loopback do SO). Se mesmo assim vier sem
    //               audio aqui, foi a pessoa quem desmarcou a opcao.
    // Firefox nao oferece NENHUM desses com audio (getDisplayMedia sem opcao
    // de audio na UI dele).
    const videoTrack = room.localParticipant.getTrackPublication(Track.Source.ScreenShare)?.track;
    const displaySurface = videoTrack?.mediaStreamTrack.getSettings().displaySurface;
    const gotAudio = !!room.localParticipant.getTrackPublication(Track.Source.ScreenShareAudio);

    if (!gotAudio) {
      // sem audio nenhum: nao e um problema pra sala (so a pessoa que
      // compartilhou nao vai levar som algum), entao so log — nao precisa
      // flutuar um aviso pra toda pessoa que compartilhar tela/janela.
      let reason: string;
      if (displaySurface === 'window') {
        reason = 'compartilhar uma JANELA nunca inclui audio, em nenhum navegador.';
      } else if (displaySurface === 'monitor') {
        reason = 'tela inteira so vem com audio se a caixa "Tambem compartilhar audio do sistema" estiver marcada (nao existe essa opcao no macOS).';
      } else {
        reason = 'a pessoa desmarcou a opcao de audio, ou o navegador nao suporta audio de tela (ex.: Firefox).';
      }
      console.log(`[screen-share] compartilhado sem audio (displaySurface=${displaySurface ?? 'desconhecido'}): ${reason}`);
    }
  }, [dispatch, room, quality]);

  const stopSharing = useCallback(() => {
    room.localParticipant.setScreenShareEnabled(false).catch(() => {});
    dispatch({ type: 'SET_LOCAL_SHARING', sharing: false });
  }, [dispatch, room]);

  return { startSharing, stopSharing, quality, setQuality };
}

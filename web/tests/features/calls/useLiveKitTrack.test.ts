import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { Track } from 'livekit-client';
import type { Participant, Room } from 'livekit-client';
import { activeTrack, getParticipant, isScreenPaused, useWatchScreenShare } from '@/features/calls/useLiveKitTrack';

describe('getParticipant', () => {
  it('devolve o localParticipant quando a identity bate com ele mesmo', () => {
    const local = { identity: 'me' };
    const room = { localParticipant: local, getParticipantByIdentity: () => undefined } as unknown as Room;
    expect(getParticipant(room, 'me')).toBe(local);
  });

  it('devolve o participante remoto encontrado por identity', () => {
    const remote = { identity: 'outro' };
    const room = {
      localParticipant: { identity: 'me' },
      getParticipantByIdentity: (id: string) => (id === 'outro' ? remote : undefined),
    } as unknown as Room;
    expect(getParticipant(room, 'outro')).toBe(remote);
  });

  it('identity desconhecida devolve undefined', () => {
    const room = { localParticipant: { identity: 'me' }, getParticipantByIdentity: () => undefined } as unknown as Room;
    expect(getParticipant(room, 'fantasma')).toBeUndefined();
  });
});

describe('activeTrack', () => {
  function fakeParticipant(pub: { isMuted: boolean; track: unknown } | null): Participant {
    return { getTrackPublication: () => pub } as unknown as Participant;
  }

  it('sem publication nenhuma, devolve null', () => {
    expect(activeTrack(fakeParticipant(null), Track.Source.Camera)).toBeNull();
  });

  it('publication MUTADA devolve null mesmo com a track ainda existindo — desligar camera/tela nao despublica, so muta', () => {
    const p = fakeParticipant({ isMuted: true, track: { id: 'trackreal' } });
    expect(activeTrack(p, Track.Source.Camera)).toBeNull();
  });

  it('publication ativa (nao mutada) devolve a track', () => {
    const track = { id: 'trackreal' };
    const p = fakeParticipant({ isMuted: false, track });
    expect(activeTrack(p, Track.Source.Camera)).toBe(track);
  });

  it('publication ativa mas sem track anexada ainda devolve null (nunca undefined)', () => {
    const p = fakeParticipant({ isMuted: false, track: undefined });
    expect(activeTrack(p, Track.Source.Camera)).toBeNull();
  });
});

describe('isScreenPaused', () => {
  function fakeParticipant(pub: { isMuted: boolean; track: unknown } | undefined): Participant {
    return { getTrackPublication: () => pub } as unknown as Participant;
  }

  it('sem publicacao nenhuma, false (nao esta pausada, nao existe)', () => {
    expect(isScreenPaused(fakeParticipant(undefined))).toBe(false);
  });

  it('publicacao ativa (nao mutada), false — esta compartilhando normalmente', () => {
    expect(isScreenPaused(fakeParticipant({ isMuted: false, track: {} }))).toBe(false);
  });

  it('publicacao mutada mas AINDA sem track, false — ainda carregando, nao "pausada de proposito"', () => {
    expect(isScreenPaused(fakeParticipant({ isMuted: true, track: undefined }))).toBe(false);
  });

  it('publicacao mutada com track presente, true — pausada de proposito (pauseSharePreview)', () => {
    expect(isScreenPaused(fakeParticipant({ isMuted: true, track: {} }))).toBe(true);
  });
});

describe('useWatchScreenShare', () => {
  function fakeRoomWithRemoteScreen() {
    const setEnabledVideo = vi.fn();
    const setEnabledAudio = vi.fn();
    const room = {
      on: vi.fn(),
      off: vi.fn(),
      localParticipant: { identity: 'me', getTrackPublication: () => undefined },
      getParticipantByIdentity: vi.fn(() => ({
        getTrackPublication: (source: Track.Source) => {
          if (source === Track.Source.ScreenShare) return { isLocal: false, setEnabled: setEnabledVideo };
          if (source === Track.Source.ScreenShareAudio) return { isLocal: false, setEnabled: setEnabledAudio };
          return undefined;
        },
      })),
    };
    return { room: room as unknown as Room, setEnabledVideo, setEnabledAudio };
  }

  it('assistindo (notWatching=false): habilita video E audio da tela remota', () => {
    const { room, setEnabledVideo, setEnabledAudio } = fakeRoomWithRemoteScreen();
    renderHook(() => useWatchScreenShare(room, 'bia', false));
    expect(setEnabledVideo).toHaveBeenCalledWith(true);
    expect(setEnabledAudio).toHaveBeenCalledWith(true);
  });

  it('parou de assistir (notWatching=true): desabilita video E audio — preserva o microfone (fora do escopo desta chamada)', () => {
    const { room, setEnabledVideo, setEnabledAudio } = fakeRoomWithRemoteScreen();
    renderHook(() => useWatchScreenShare(room, 'bia', true));
    expect(setEnabledVideo).toHaveBeenCalledWith(false);
    expect(setEnabledAudio).toHaveBeenCalledWith(false);
  });

  it('nunca chama setEnabled numa publicacao LOCAL — "assistir" so faz sentido pra tela de outra pessoa', () => {
    const setEnabledLocal = vi.fn();
    const room = {
      on: vi.fn(),
      off: vi.fn(),
      localParticipant: { identity: 'me', getTrackPublication: () => ({ isLocal: true, setEnabled: setEnabledLocal }) },
      getParticipantByIdentity: vi.fn(() => undefined),
    } as unknown as Room;
    renderHook(() => useWatchScreenShare(room, 'me', true));
    expect(setEnabledLocal).not.toHaveBeenCalled();
  });
});

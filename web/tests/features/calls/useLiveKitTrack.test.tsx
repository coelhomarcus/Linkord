import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ConnectionQuality, Track } from 'livekit-client';
import type { Participant, Room } from 'livekit-client';
import {
  activeTrack, getParticipant, isScreenPaused, useConnectionQuality, useParticipantMedia, useWatchScreenShare,
} from '@/features/calls/useLiveKitTrack';
import { RoomContext } from '@/state/RoomContext';
import { createFakeRoomContextValue } from '@tests/fixtures/roomContextFixture';

/** A minimal but real pub-sub fake — `on`/`off` are spies wrapping an actual
 * listener registry, so events genuinely reach whoever subscribed (needed to
 * prove sharing: a fake that just no-ops would "pass" even if every watcher
 * secretly got its own broken registration). */
function fakeEventRoom() {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const on = vi.fn((event: string, cb: (...args: unknown[]) => void) => {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event)!.add(cb);
  });
  const off = vi.fn((event: string, cb: (...args: unknown[]) => void) => {
    listeners.get(event)?.delete(cb);
  });
  const participants = new Map<string, Participant>();
  const raw = {
    on,
    off,
    localParticipant: { identity: '__local__', getTrackPublication: () => undefined },
    getParticipantByIdentity: (id: string) => participants.get(id),
    emit(event: string, ...args: unknown[]) { for (const cb of listeners.get(event) ?? []) cb(...args); },
    addParticipant(id: string, p: Partial<Participant>) { participants.set(id, p as Participant); },
  };
  const room = raw as unknown as Room & { emit: (event: string, ...args: unknown[]) => void; addParticipant: (id: string, p: Partial<Participant>) => void };
  return { room, on, off };
}

function roomWrapper(room: Room) {
  return ({ children }: { children: ReactNode }) => (
    <RoomContext.Provider value={createFakeRoomContextValue({ livekitRoom: room })}>{children}</RoomContext.Provider>
  );
}

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

describe('useParticipantMedia — assinatura compartilhada por identidade (plano §11.2)', () => {
  it('duas instancias observando a MESMA identidade registram os listeners do LiveKit uma unica vez', () => {
    const { room, on, off } = fakeEventRoom();
    const wrapper = roomWrapper(room);

    const a = renderHook(() => useParticipantMedia('p-2'), { wrapper });
    const onCallsAfterFirst = on.mock.calls.length;
    expect(onCallsAfterFirst).toBeGreaterThan(0);

    const b = renderHook(() => useParticipantMedia('p-2'), { wrapper });
    expect(on.mock.calls.length).toBe(onCallsAfterFirst);

    a.unmount();
    expect(off).not.toHaveBeenCalled();

    b.unmount();
    expect(off.mock.calls.length).toBe(onCallsAfterFirst);
  });

  it('identidades DIFERENTES continuam com assinaturas totalmente independentes', () => {
    const { room, on } = fakeEventRoom();
    const wrapper = roomWrapper(room);

    renderHook(() => useParticipantMedia('p-2'), { wrapper });
    const afterFirst = on.mock.calls.length;
    renderHook(() => useParticipantMedia('p-3'), { wrapper });
    expect(on.mock.calls.length).toBe(afterFirst * 2);
  });

  it('um evento real de track reflete nos DOIS observadores da mesma identidade', () => {
    const { room } = fakeEventRoom();
    room.addParticipant('p-2', { getTrackPublication: (() => ({ isMuted: false, track: { id: 'cam' } })) as unknown as Participant['getTrackPublication'] });
    const wrapper = roomWrapper(room);

    const a = renderHook(() => useParticipantMedia('p-2'), { wrapper });
    const b = renderHook(() => useParticipantMedia('p-2'), { wrapper });
    expect(a.result.current.cameraTrack).toEqual({ id: 'cam' });
    expect(b.result.current.cameraTrack).toEqual({ id: 'cam' });

    room.addParticipant('p-2', { getTrackPublication: () => undefined });
    act(() => { room.emit('trackUnpublished'); });
    expect(a.result.current.cameraTrack).toBeNull();
    expect(b.result.current.cameraTrack).toBeNull();
  });
});

describe('useConnectionQuality — mesma assinatura compartilhada', () => {
  it('duas instancias observando a MESMA identidade registram um unico listener de ConnectionQualityChanged', () => {
    const { room, on, off } = fakeEventRoom();
    const wrapper = roomWrapper(room);

    const a = renderHook(() => useConnectionQuality('p-2'), { wrapper });
    const onCallsAfterFirst = on.mock.calls.length;
    expect(onCallsAfterFirst).toBe(1);

    const b = renderHook(() => useConnectionQuality('p-2'), { wrapper });
    expect(on.mock.calls.length).toBe(onCallsAfterFirst);

    a.unmount();
    expect(off).not.toHaveBeenCalled();
    b.unmount();
    expect(off).toHaveBeenCalledTimes(1);
  });

  it('reflete a qualidade real do participante e reage a mudancas', () => {
    const { room } = fakeEventRoom();
    room.addParticipant('p-2', { connectionQuality: ConnectionQuality.Good });
    const wrapper = roomWrapper(room);

    const { result } = renderHook(() => useConnectionQuality('p-2'), { wrapper });
    expect(result.current).toBe(ConnectionQuality.Good);

    room.addParticipant('p-2', { connectionQuality: ConnectionQuality.Poor });
    act(() => { room.emit('connectionQualityChanged'); });
    expect(result.current).toBe(ConnectionQuality.Poor);
  });
});

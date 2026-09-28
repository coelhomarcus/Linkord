import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { RoomEvent, Track } from 'livekit-client';
import type { Room } from 'livekit-client';
import { RoomContext } from '@/state/RoomContext';
import { createFakeRoomContextValue } from '@tests/fixtures/roomContextFixture';
import { useCallTiles } from '@/features/calls/useCallTiles';

interface FakePublication {
  isMuted: boolean;
  track: object | null;
}

function fakeParticipant() {
  const publications = new Map<Track.Source, FakePublication>();
  return {
    getTrackPublication: vi.fn((source: Track.Source) => publications.get(source)),
    // test-only helpers, not part of the real Participant API
    setPublication(source: Track.Source, pub: FakePublication | undefined) {
      if (pub) publications.set(source, pub); else publications.delete(source);
    },
  };
}

function fakeRoom() {
  const listeners = new Map<string, Set<() => void>>();
  const remoteParticipants = new Map<string, ReturnType<typeof fakeParticipant>>();
  const room = {
    emit: (event: string) => { for (const fn of listeners.get(event) ?? []) fn(); },
    on: vi.fn((event: string, fn: () => void) => { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event)!.add(fn); }),
    off: vi.fn((event: string, fn: () => void) => { listeners.get(event)?.delete(fn); }),
    localParticipant: { identity: '', getTrackPublication: vi.fn(() => undefined) },
    getParticipantByIdentity: vi.fn((id: string) => remoteParticipants.get(id)),
    // test-only
    addRemote(id: string) {
      const p = fakeParticipant();
      remoteParticipants.set(id, p);
      return p;
    },
  };
  return room as unknown as Room & {
    emit: (event: string) => void;
    localParticipant: { identity: string; getTrackPublication: ReturnType<typeof vi.fn> };
    addRemote: (id: string) => ReturnType<typeof fakeParticipant>;
  };
}

describe('useCallTiles', () => {
  it('sozinho e sem microfone, o proprio tile aparece assim que a conexao completa', () => {
    const livekitRoom = fakeRoom();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <RoomContext.Provider value={createFakeRoomContextValue({ livekitRoom })}>{children}</RoomContext.Provider>
    );
    const { result } = renderHook(() => useCallTiles(['me']), { wrapper });
    expect(result.current).toEqual([]);

    livekitRoom.localParticipant.identity = 'me';
    act(() => { livekitRoom.emit(RoomEvent.Connected); });

    expect(result.current).toEqual([{ key: expect.any(String), participantId: 'me', kind: 'avatar', loading: false, paused: false }]);
  });

  it('ligar a camera preserva a mesma chave do tile (nao remonta)', () => {
    const livekitRoom = fakeRoom();
    const remote = livekitRoom.addRemote('bia');
    const wrapper = ({ children }: { children: ReactNode }) => (
      <RoomContext.Provider value={createFakeRoomContextValue({ livekitRoom })}>{children}</RoomContext.Provider>
    );
    const { result } = renderHook(() => useCallTiles(['bia']), { wrapper });
    act(() => { livekitRoom.emit(RoomEvent.ParticipantConnected); });
    const keyBefore = result.current[0]!.key;
    expect(result.current[0]).toMatchObject({ kind: 'avatar', loading: false });

    remote.setPublication(Track.Source.Camera, { isMuted: false, track: {} });
    act(() => { livekitRoom.emit(RoomEvent.TrackSubscribed); });

    expect(result.current[0]).toMatchObject({ kind: 'camera', key: keyBefore });
  });

  it('publicacao de camera sem track ainda vira "loading", nao "sem camera"', () => {
    const livekitRoom = fakeRoom();
    const remote = livekitRoom.addRemote('bia');
    const wrapper = ({ children }: { children: ReactNode }) => (
      <RoomContext.Provider value={createFakeRoomContextValue({ livekitRoom })}>{children}</RoomContext.Provider>
    );
    const { result } = renderHook(() => useCallTiles(['bia']), { wrapper });

    // the publication announces before the track actually subscribes
    remote.setPublication(Track.Source.Camera, { isMuted: false, track: null });
    act(() => { livekitRoom.emit(RoomEvent.TrackPublished); });

    expect(result.current[0]).toMatchObject({ kind: 'avatar', loading: true });

    remote.setPublication(Track.Source.Camera, { isMuted: false, track: {} });
    act(() => { livekitRoom.emit(RoomEvent.TrackSubscribed); });

    expect(result.current[0]).toMatchObject({ kind: 'camera', loading: false });
  });

  it('camera mutada nao conta como "loading" (e so mesmo desligada)', () => {
    const livekitRoom = fakeRoom();
    const remote = livekitRoom.addRemote('bia');
    const wrapper = ({ children }: { children: ReactNode }) => (
      <RoomContext.Provider value={createFakeRoomContextValue({ livekitRoom })}>{children}</RoomContext.Provider>
    );
    const { result } = renderHook(() => useCallTiles(['bia']), { wrapper });

    remote.setPublication(Track.Source.Camera, { isMuted: true, track: null });
    act(() => { livekitRoom.emit(RoomEvent.TrackPublished); });

    expect(result.current[0]).toMatchObject({ kind: 'avatar', loading: false });
  });

  it('tela compartilhada aparece como "loading" antes do track chegar', () => {
    const livekitRoom = fakeRoom();
    const remote = livekitRoom.addRemote('bia');
    const wrapper = ({ children }: { children: ReactNode }) => (
      <RoomContext.Provider value={createFakeRoomContextValue({ livekitRoom })}>{children}</RoomContext.Provider>
    );
    const { result } = renderHook(() => useCallTiles(['bia']), { wrapper });

    remote.setPublication(Track.Source.ScreenShare, { isMuted: false, track: null });
    act(() => { livekitRoom.emit(RoomEvent.TrackPublished); });

    const screenTile = result.current.find((d) => d.kind === 'screen');
    expect(screenTile).toMatchObject({ loading: true });
  });

  it('tela pausada (publicacao muted mas com track) continua aparecendo, marcada como "paused" — nao some', () => {
    const livekitRoom = fakeRoom();
    const remote = livekitRoom.addRemote('bia');
    const wrapper = ({ children }: { children: ReactNode }) => (
      <RoomContext.Provider value={createFakeRoomContextValue({ livekitRoom })}>{children}</RoomContext.Provider>
    );
    const { result } = renderHook(() => useCallTiles(['bia']), { wrapper });

    remote.setPublication(Track.Source.ScreenShare, { isMuted: false, track: {} });
    act(() => { livekitRoom.emit(RoomEvent.TrackSubscribed); });
    expect(result.current.find((d) => d.kind === 'screen')).toMatchObject({ loading: false, paused: false });

    remote.setPublication(Track.Source.ScreenShare, { isMuted: true, track: {} });
    act(() => { livekitRoom.emit(RoomEvent.TrackMuted); });

    const screenTile = result.current.find((d) => d.kind === 'screen');
    expect(screenTile).toMatchObject({ loading: false, paused: true });
  });

  it('tela encerrada (sem publicacao) some do grid, nao fica "paused" para sempre', () => {
    const livekitRoom = fakeRoom();
    const remote = livekitRoom.addRemote('bia');
    const wrapper = ({ children }: { children: ReactNode }) => (
      <RoomContext.Provider value={createFakeRoomContextValue({ livekitRoom })}>{children}</RoomContext.Provider>
    );
    const { result } = renderHook(() => useCallTiles(['bia']), { wrapper });

    remote.setPublication(Track.Source.ScreenShare, { isMuted: true, track: {} });
    act(() => { livekitRoom.emit(RoomEvent.TrackMuted); });
    expect(result.current.find((d) => d.kind === 'screen')).toMatchObject({ paused: true });

    remote.setPublication(Track.Source.ScreenShare, undefined);
    act(() => { livekitRoom.emit(RoomEvent.TrackUnpublished); });

    expect(result.current.find((d) => d.kind === 'screen')).toBeUndefined();
  });
});

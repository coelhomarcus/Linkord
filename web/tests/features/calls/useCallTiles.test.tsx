import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { RoomEvent } from 'livekit-client';
import type { Room } from 'livekit-client';
import { RoomContext } from '@/state/RoomContext';
import { createFakeRoomContextValue } from '@tests/fixtures/roomContextFixture';
import { useCallTiles } from '@/features/calls/useCallTiles';

function fakeRoom() {
  const listeners = new Map<string, Set<() => void>>();
  const room = {
    emit: (event: string) => { for (const fn of listeners.get(event) ?? []) fn(); },
    on: vi.fn((event: string, fn: () => void) => { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event)!.add(fn); }),
    off: vi.fn((event: string, fn: () => void) => { listeners.get(event)?.delete(fn); }),
    localParticipant: { identity: '', getTrackPublication: vi.fn(() => undefined) },
    getParticipantByIdentity: vi.fn(() => undefined),
  };
  return room as unknown as Room & { emit: (event: string) => void; localParticipant: { identity: string } };
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

    expect(result.current).toEqual([{ key: expect.any(String), participantId: 'me', kind: 'avatar' }]);
  });
});

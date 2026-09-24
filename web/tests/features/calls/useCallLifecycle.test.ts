import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { DisconnectReason, RoomEvent } from 'livekit-client';
import type { Room } from 'livekit-client';
import { useCallLifecycle } from '@/features/calls/useCallLifecycle';

function fakeRoom(connect: () => Promise<void>) {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  return {
    emit: (event: string, ...args: unknown[]) => { for (const fn of listeners.get(event) ?? []) fn(...args); },
    on: vi.fn((event: string, fn: (...args: unknown[]) => void) => { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event)!.add(fn); }),
    off: vi.fn((event: string, fn: (...args: unknown[]) => void) => { listeners.get(event)?.delete(fn); }),
    connect: vi.fn(connect),
    disconnect: vi.fn(),
    localParticipant: { identity: 'me', getTrackPublication: vi.fn(() => undefined) },
  } as unknown as Room & { emit: (event: string, ...args: unknown[]) => void };
}

function setup(connect: () => Promise<void> = async () => undefined) {
  const dispatch = vi.fn();
  const sendWs = vi.fn();
  const livekitRoom = fakeRoom(connect);
  const { result } = renderHook(() => useCallLifecycle({
    livekitRoom, dispatch, sendWs,
    stopCamera: vi.fn(), stopSharing: vi.fn(),
    activateMic: vi.fn(async () => undefined), setMicMuted: vi.fn(async () => undefined), leaveMic: vi.fn(async () => undefined),
    cameraOn: false, sharing: false,
  }));
  return { result, dispatch, sendWs, livekitRoom };
}

const token = { conversationId: 'c1', livekitUrl: 'wss://lk', livekitToken: 't' };

describe('useCallLifecycle — chamada que nao conseguiu comecar', () => {
  it('recusa do server para um join pendente vira erro daquela conversa', async () => {
    const { result, dispatch } = setup();
    await act(async () => { await result.current.joinCall('c1'); });

    let handled = false;
    act(() => { handled = result.current.onCallJoinRejected('Vocês precisam ser amigos pra iniciar essa chamada.'); });

    expect(handled).toBe(true);
    expect(dispatch).toHaveBeenLastCalledWith({ type: 'SET_CALL_JOIN_ERROR', error: { conversationId: 'c1', message: 'Vocês precisam ser amigos pra iniciar essa chamada.' } });
  });

  it('sem join pendente, a recusa nao e dela (o mesmo codigo responde outras acoes)', () => {
    const { result, dispatch } = setup();
    let handled = true;
    act(() => { handled = result.current.onCallJoinRejected('qualquer'); });
    expect(handled).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('falha ao conectar no LiveKit: sai da chamada, avisa e deixa tentar de novo', async () => {
    let livekitRoom: ReturnType<typeof fakeRoom> | null = null;
    // the real Room emits Disconnected before the connect() promise rejects
    const { result, dispatch, sendWs, livekitRoom: room } = setup(async () => {
      await Promise.resolve();
      livekitRoom!.emit(RoomEvent.Disconnected, DisconnectReason.UNKNOWN_REASON);
      throw new Error('could not establish signal connection');
    });
    livekitRoom = room;
    await act(async () => { await result.current.joinCall('c1'); });
    await act(async () => { result.current.onCallToken(token); });

    await vi.waitFor(() => expect(result.current.activeCallConversationId).toBeNull());
    expect(sendWs).toHaveBeenCalledWith({ t: 'call-leave' });
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_CALL_JOIN_ERROR', error: { conversationId: 'c1', message: expect.stringContaining('Não foi possível conectar à chamada') } });

    sendWs.mockClear();
    await act(async () => { await result.current.joinCall('c1'); });
    expect(sendWs).toHaveBeenCalledWith({ t: 'call-join', conversationId: 'c1' });
  });

  it('conexao cancelada porque a pessoa saiu antes: nenhum erro', async () => {
    let rejectConnect: (err: Error) => void = () => {};
    const { result, dispatch } = setup(() => new Promise<void>((_resolve, reject) => { rejectConnect = reject; }));
    await act(async () => { await result.current.joinCall('c1'); });
    act(() => { result.current.onCallToken(token); });
    await act(async () => { await result.current.leaveCall(); });

    await act(async () => { rejectConnect(new Error('Client initiated disconnect')); });

    expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'SET_CALL_JOIN_ERROR', error: expect.anything() }));
  });
});

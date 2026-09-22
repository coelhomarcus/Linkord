import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { Room } from 'livekit-client';
import { useMediaDevices } from '@/features/settings/useMediaDevices';

// jsdom doesn't implement mediaDevices at all — defined once for the whole
// file (not reset in afterEach: that raced RTL's own unmount cleanup, which
// runs in the global setup's afterEach and needs this to still be there).
Object.defineProperty(navigator, 'mediaDevices', { value: new EventTarget(), configurable: true });

beforeEach(() => {
  vi.restoreAllMocks();
});

function fakeRoom(activeDeviceId: string | undefined = undefined) {
  return {
    getActiveDevice: vi.fn(() => activeDeviceId),
    switchActiveDevice: vi.fn(async () => undefined),
  } as never;
}

describe('useMediaDevices', () => {
  it('sem navigator.mediaDevices o seletor fica vazio em vez de lancar do efeito', async () => {
    vi.spyOn(Room, 'getLocalDevices').mockRejectedValue(new TypeError("Cannot read properties of undefined (reading 'enumerateDevices')"));
    const room = fakeRoom();
    const { result } = renderHook(() => useMediaDevices(room, 'audioinput'));

    await waitFor(() => expect(result.current.status).toBe('unsupported'));
    expect(result.current.devices).toEqual([]);
  });

  it('nunca pediu: dispositivos sem label viram "permission-needed"', async () => {
    vi.spyOn(Room, 'getLocalDevices').mockResolvedValue([
      { deviceId: 'd1', label: '', kind: 'audioinput' } as MediaDeviceInfo,
    ]);
    const room = fakeRoom();
    const { result } = renderHook(() => useMediaDevices(room, 'audioinput'));

    await waitFor(() => expect(result.current.status).toBe('permission-needed'));
  });

  it('pediu (requestPermission) e continua sem label: "permission-denied", nao "unsupported"', async () => {
    vi.spyOn(Room, 'getLocalDevices').mockResolvedValue([
      { deviceId: 'd1', label: '', kind: 'audioinput' } as MediaDeviceInfo,
    ]);
    const room = fakeRoom();
    const { result } = renderHook(() => useMediaDevices(room, 'audioinput'));
    await waitFor(() => expect(result.current.status).toBe('permission-needed'));

    await waitFor(async () => { await result.current.requestPermission(); expect(result.current.status).toBe('permission-denied'); });
  });

  it('getLocalDevices rejeita no pedido explicito (negado no prompt nativo): "permission-denied"', async () => {
    vi.spyOn(Room, 'getLocalDevices')
      .mockResolvedValueOnce([{ deviceId: 'd1', label: '', kind: 'audioinput' } as MediaDeviceInfo])
      .mockRejectedValueOnce(Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' }));
    const room = fakeRoom();
    const { result } = renderHook(() => useMediaDevices(room, 'audioinput'));
    await waitFor(() => expect(result.current.status).toBe('permission-needed'));

    await result.current.requestPermission();
    await waitFor(() => expect(result.current.status).toBe('permission-denied'));
  });

  it('lista vazia (suportado, com permissao): "no-devices"', async () => {
    vi.spyOn(Room, 'getLocalDevices').mockResolvedValue([]);
    const room = fakeRoom();
    const { result } = renderHook(() => useMediaDevices(room, 'audioinput'));

    await waitFor(() => expect(result.current.status).toBe('no-devices'));
  });

  it('trocar de dispositivo com falha mostra erro recuperavel e nao muda o ativo', async () => {
    vi.spyOn(Room, 'getLocalDevices').mockResolvedValue([
      { deviceId: 'd1', label: 'Mic 1', kind: 'audioinput' } as MediaDeviceInfo,
      { deviceId: 'd2', label: 'Mic 2', kind: 'audioinput' } as MediaDeviceInfo,
    ]);
    const room = fakeRoom('d1');
    (room as { switchActiveDevice: ReturnType<typeof vi.fn> }).switchActiveDevice.mockRejectedValue(new Error('nope'));
    const { result } = renderHook(() => useMediaDevices(room, 'audioinput'));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await result.current.selectDevice('d2');
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.activeDeviceId).toBe('d1');
  });

  it('devicechange atualiza a lista sem esperar um novo mount', async () => {
    const spy = vi.spyOn(Room, 'getLocalDevices').mockResolvedValue([
      { deviceId: 'd1', label: 'Mic 1', kind: 'audioinput' } as MediaDeviceInfo,
    ]);
    const room = fakeRoom('d1');
    const { result } = renderHook(() => useMediaDevices(room, 'audioinput'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    const callsBeforeChange = spy.mock.calls.length;

    spy.mockResolvedValue([
      { deviceId: 'd1', label: 'Mic 1', kind: 'audioinput' } as MediaDeviceInfo,
      { deviceId: 'd2', label: 'Mic 2 (novo)', kind: 'audioinput' } as MediaDeviceInfo,
    ]);
    navigator.mediaDevices.dispatchEvent(new Event('devicechange'));
    await waitFor(() => expect(result.current.devices).toHaveLength(2));
    expect(spy.mock.calls.length).toBeGreaterThan(callsBeforeChange);
  });
});

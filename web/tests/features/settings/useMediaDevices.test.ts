import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Room } from 'livekit-client';
import { useMediaDevices } from '@/features/settings/useMediaDevices';

describe('useMediaDevices', () => {
  it('sem navigator.mediaDevices o seletor fica vazio em vez de lancar do efeito', async () => {
    const spy = vi.spyOn(Room, 'getLocalDevices').mockRejectedValue(new TypeError("Cannot read properties of undefined (reading 'enumerateDevices')"));
    const room = { getActiveDevice: vi.fn(), switchActiveDevice: vi.fn() } as never;
    const { result } = renderHook(() => useMediaDevices(room, 'audioinput'));

    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(result.current.devices).toEqual([]);
    expect(result.current.permissionNeeded).toBe(false);
    spy.mockRestore();
  });
});

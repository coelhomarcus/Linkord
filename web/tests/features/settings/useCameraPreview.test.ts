import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useCameraPreview } from '@/features/settings/useCameraPreview';

function fakeTrack() {
  return { stop: vi.fn(), kind: 'video' };
}

function fakeStream(tracks = [fakeTrack()]) {
  return { getTracks: () => tracks };
}

let getUserMedia: ReturnType<typeof vi.fn>;

beforeEach(() => {
  getUserMedia = vi.fn().mockResolvedValue(fakeStream());
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true });
});

afterEach(() => {
  Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true });
});

describe('useCameraPreview', () => {
  it('nao inicia sozinho — so apos start() explicito', () => {
    renderHook(() => useCameraPreview());
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('start() abre a camera pedida e expoe a stream', async () => {
    const { result } = renderHook(() => useCameraPreview());
    await act(async () => { await result.current.start('cam-1'); });
    expect(getUserMedia).toHaveBeenCalledWith({ video: { deviceId: { exact: 'cam-1' } } });
    expect(result.current.active).toBe(true);
    expect(result.current.stream).not.toBeNull();
  });

  it('stop() para todas as tracks — a luz da camera tem que apagar', async () => {
    const track = fakeTrack();
    getUserMedia.mockResolvedValue(fakeStream([track]));
    const { result } = renderHook(() => useCameraPreview());
    await act(async () => { await result.current.start(); });

    act(() => result.current.stop());
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(result.current.active).toBe(false);
    expect(result.current.stream).toBeNull();
  });

  it('desmontar sem chamar stop() ainda assim libera a camera', async () => {
    const track = fakeTrack();
    getUserMedia.mockResolvedValue(fakeStream([track]));
    const { result, unmount } = renderHook(() => useCameraPreview());
    await act(async () => { await result.current.start(); });

    unmount();
    expect(track.stop).toHaveBeenCalledTimes(1);
  });

  it('trocar de dispositivo com a previa ja ativa para a antiga stream antes de abrir a nova', async () => {
    const trackA = fakeTrack();
    const trackB = fakeTrack();
    getUserMedia.mockResolvedValueOnce(fakeStream([trackA])).mockResolvedValueOnce(fakeStream([trackB]));
    const { result } = renderHook(() => useCameraPreview());
    await act(async () => { await result.current.start('cam-1'); });
    await act(async () => { await result.current.start('cam-2'); });

    expect(trackA.stop).toHaveBeenCalledTimes(1);
    expect(trackB.stop).not.toHaveBeenCalled();
  });

  it('deviceId "default" (sentinela do LiveKit) nao vira uma constraint exata', async () => {
    const { result } = renderHook(() => useCameraPreview());
    await act(async () => { await result.current.start('default'); });
    expect(getUserMedia).toHaveBeenCalledWith({ video: true });
  });

  it('permissao negada mostra erro proprio, sem ficar "ativa"', async () => {
    getUserMedia.mockRejectedValue(Object.assign(new Error('nope'), { name: 'NotAllowedError' }));
    const { result } = renderHook(() => useCameraPreview());
    await act(async () => { await result.current.start(); });
    expect(result.current.active).toBe(false);
    expect(result.current.error).toBeTruthy();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useMicLevelMeter } from '@/features/settings/useMicLevelMeter';

function fakeTrack() {
  return { stop: vi.fn(), kind: 'audio' };
}

function fakeStream(tracks = [fakeTrack()]) {
  return { getTracks: () => tracks };
}

let getUserMedia: ReturnType<typeof vi.fn>;
let closeMock: ReturnType<typeof vi.fn>;
let rafCallbacks: FrameRequestCallback[];

class FakeAnalyser {
  fftSize = 2048;
  frequencyBinCount = 1024;
  getByteTimeDomainData(arr: Uint8Array) { arr.fill(128); }
}

class FakeAudioContext {
  createMediaStreamSource() { return { connect: vi.fn() }; }
  createAnalyser() { return new FakeAnalyser(); }
  close = closeMock;
}

beforeEach(() => {
  rafCallbacks = [];
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { rafCallbacks.push(cb); return rafCallbacks.length; });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  closeMock = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('AudioContext', FakeAudioContext);
  getUserMedia = vi.fn().mockResolvedValue(fakeStream());
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useMicLevelMeter', () => {
  it('nao inicia sozinho — so apos start() explicito', () => {
    renderHook(() => useMicLevelMeter());
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('start() abre o mic com o deviceId pedido, sem tocar em room.localParticipant', async () => {
    const { result } = renderHook(() => useMicLevelMeter());
    await act(async () => { await result.current.start('mic-1'); });
    expect(getUserMedia).toHaveBeenCalledWith({ audio: { deviceId: { exact: 'mic-1' } } });
    expect(result.current.active).toBe(true);
  });

  it('stop() para todas as tracks e fecha o AudioContext', async () => {
    const track = fakeTrack();
    getUserMedia.mockResolvedValue(fakeStream([track]));
    const { result } = renderHook(() => useMicLevelMeter());
    await act(async () => { await result.current.start(); });

    act(() => result.current.stop());
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(closeMock).toHaveBeenCalledTimes(1);
    expect(result.current.active).toBe(false);
    expect(result.current.level).toBe(0);
  });

  it('desmontar sem chamar stop() ainda assim libera o mic (nao vaza)', async () => {
    const track = fakeTrack();
    getUserMedia.mockResolvedValue(fakeStream([track]));
    const { result, unmount } = renderHook(() => useMicLevelMeter());
    await act(async () => { await result.current.start(); });

    unmount();
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(closeMock).toHaveBeenCalledTimes(1);
  });

  it('um segundo start() para o primeiro antes de abrir outro (sem duas streams simultaneas)', async () => {
    const trackA = fakeTrack();
    const trackB = fakeTrack();
    getUserMedia.mockResolvedValueOnce(fakeStream([trackA])).mockResolvedValueOnce(fakeStream([trackB]));
    const { result } = renderHook(() => useMicLevelMeter());
    await act(async () => { await result.current.start('mic-1'); });
    await act(async () => { await result.current.start('mic-2'); });

    expect(trackA.stop).toHaveBeenCalledTimes(1);
    expect(trackB.stop).not.toHaveBeenCalled();
    expect(getUserMedia).toHaveBeenLastCalledWith({ audio: { deviceId: { exact: 'mic-2' } } });
  });

  it('deviceId "default" (sentinela do LiveKit pra "nenhuma escolha ainda") nao vira uma constraint exata', async () => {
    // um deviceId real nunca é a string "default" — usar exact aqui derruba
    // com OverconstrainedError em qualquer device real (achado só ao vivo).
    const { result } = renderHook(() => useMicLevelMeter());
    await act(async () => { await result.current.start('default'); });
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
  });

  it('permissao negada mostra um erro proprio, sem travar active em true', async () => {
    getUserMedia.mockRejectedValue(Object.assign(new Error('nope'), { name: 'NotAllowedError' }));
    const { result } = renderHook(() => useMicLevelMeter());
    await act(async () => { await result.current.start(); });
    expect(result.current.active).toBe(false);
    expect(result.current.error).toBeTruthy();
  });
});

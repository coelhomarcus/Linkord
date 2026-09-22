import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useSpeakerTest } from '@/features/settings/useSpeakerTest';

class FakeAudio {
  static instances: FakeAudio[] = [];
  src: string;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  play = vi.fn().mockResolvedValue(undefined);
  pause = vi.fn();
  setSinkId = vi.fn().mockResolvedValue(undefined);
  constructor(src: string) {
    this.src = src;
    FakeAudio.instances.push(this);
  }
}

beforeEach(() => {
  FakeAudio.instances = [];
  vi.stubGlobal('Audio', FakeAudio);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useSpeakerTest', () => {
  it('nao toca nada sozinho — so apos test() explicito', () => {
    renderHook(() => useSpeakerTest());
    expect(FakeAudio.instances).toHaveLength(0);
  });

  it('test(deviceId) roteia pro dispositivo escolhido antes de tocar', async () => {
    const { result } = renderHook(() => useSpeakerTest());
    await act(async () => { await result.current.test('speaker-1'); });

    const audio = FakeAudio.instances[0]!;
    expect(audio.setSinkId).toHaveBeenCalledWith('speaker-1');
    expect(audio.play).toHaveBeenCalledTimes(1);
    expect(result.current.testing).toBe(true);
  });

  it('onended volta testing pra false sozinho', async () => {
    const { result } = renderHook(() => useSpeakerTest());
    await act(async () => { await result.current.test(); });
    act(() => FakeAudio.instances[0]!.onended?.());
    expect(result.current.testing).toBe(false);
  });

  it('um segundo test() pausa o audio anterior antes de tocar o novo', async () => {
    const { result } = renderHook(() => useSpeakerTest());
    await act(async () => { await result.current.test('a'); });
    await act(async () => { await result.current.test('b'); });

    expect(FakeAudio.instances[0]!.pause).toHaveBeenCalledTimes(1);
    expect(FakeAudio.instances[1]!.play).toHaveBeenCalledTimes(1);
  });

  it('desmontar no meio de um teste pausa o audio (nao continua tocando)', async () => {
    const { result, unmount } = renderHook(() => useSpeakerTest());
    await act(async () => { await result.current.test(); });
    unmount();
    expect(FakeAudio.instances[0]!.pause).toHaveBeenCalledTimes(1);
  });

  it('falha ao tocar mostra um erro recuperavel', async () => {
    class FailingAudio extends FakeAudio {
      play = vi.fn().mockRejectedValue(new Error('nope'));
    }
    vi.stubGlobal('Audio', FailingAudio);
    const { result } = renderHook(() => useSpeakerTest());

    await act(async () => { await result.current.test(); });
    expect(result.current.error).toBeTruthy();
    expect(result.current.testing).toBe(false);
  });
});

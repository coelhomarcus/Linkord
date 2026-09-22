import { useCallback, useEffect, useRef, useState } from 'react';
import { logger } from '@/shared/lib/logger';

const log = logger.child({ component: 'mic-level-meter' });

export interface MicLevelMeterApi {
  /** 0..1, only meaningful while `active`. */
  level: number;
  active: boolean;
  error: string | null;
  start: (deviceId?: string) => Promise<void>;
  stop: () => void;
}

/** "Testar microfone" in Settings — a live level meter, entirely separate
 * from any call: its own getUserMedia stream, own AudioContext, never
 * touches room.localParticipant (useMicrophone.ts owns that). Only starts
 * on an explicit gesture, and stop() — called on click, on unmount, and
 * before every new start() — always releases the mic and closes the
 * AudioContext, so nothing keeps the mic indicator lit after leaving. */
export function useMicLevelMeter(): MicLevelMeterApi {
  const [level, setLevel] = useState(0);
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);

  const stop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    setActive(false);
    setLevel(0);
  }, []);

  const start = useCallback(async (deviceId?: string) => {
    stop();
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Seu navegador não suporta testar o microfone.');
      return;
    }
    try {
      // 'default' is a real value getActiveDevice() can return (LiveKit's
      // own sentinel for "no explicit choice yet"), not an actual device id
      // — passing it as an exact constraint throws OverconstrainedError.
      const pick = deviceId && deviceId !== 'default' ? { deviceId: { exact: deviceId } } : true;
      const stream = await navigator.mediaDevices.getUserMedia({ audio: pick });
      streamRef.current = stream;
      const AudioContextCtor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextCtor) {
        for (const track of stream.getTracks()) track.stop();
        streamRef.current = null;
        setError('Seu navegador não suporta testar o microfone.');
        return;
      }
      const ctx = new AudioContextCtor();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      setActive(true);
      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let sumSquares = 0;
        for (const value of data) {
          const centered = (value - 128) / 128;
          sumSquares += centered * centered;
        }
        const rms = Math.sqrt(sumSquares / data.length);
        setLevel(Math.min(1, rms * 4));
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch (err) {
      log.warn('Failed to start mic level meter', { err: String(err) });
      const name = (err as DOMException)?.name;
      const denied = name === 'NotAllowedError' || name === 'NotFoundError';
      setError(denied ? 'Não foi possível acessar o microfone.' : 'Não foi possível testar o microfone agora.');
    }
  }, [stop]);

  useEffect(() => () => stop(), [stop]);

  return { level, active, error, start, stop };
}

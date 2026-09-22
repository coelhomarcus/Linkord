import { useCallback, useEffect, useRef, useState } from 'react';
import { logger } from '@/shared/lib/logger';

const log = logger.child({ component: 'speaker-test' });

export interface SpeakerTestApi {
  testing: boolean;
  error: string | null;
  test: (deviceId?: string) => Promise<void>;
}

/** "Testar" alto-falante — a dedicated <audio> element, not the preloaded
 * pool in shared/sounds.ts (setSinkId is per-element, and that pool always
 * plays on whatever the system default is; here the point is testing ONE
 * specific device, regardless of the notification volume/output). Same
 * setSinkId technique and support guard as ParticipantAudioLayer.tsx. */
export function useSpeakerTest(): SpeakerTestApi {
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const stop = useCallback(() => {
    audioRef.current?.pause();
    audioRef.current = null;
  }, []);

  useEffect(() => () => stop(), [stop]);

  const test = useCallback(async (deviceId?: string) => {
    stop();
    setError(null);
    const audio = new Audio('/sounds/new-message.mp3');
    audioRef.current = audio;
    if (deviceId && 'setSinkId' in audio) {
      try {
        await (audio as HTMLAudioElement & { setSinkId(sinkId: string): Promise<void> }).setSinkId(deviceId);
      } catch (err) {
        log.warn('Failed to route the test sound to that output', { err: String(err) });
      }
    }
    audio.onended = () => { setTesting(false); if (audioRef.current === audio) audioRef.current = null; };
    audio.onerror = () => {
      setTesting(false);
      setError('Não foi possível tocar o som de teste.');
      if (audioRef.current === audio) audioRef.current = null;
    };
    try {
      setTesting(true);
      await audio.play();
    } catch (err) {
      log.warn('Failed to play the test sound', { err: String(err) });
      setTesting(false);
      setError('Não foi possível tocar o som de teste.');
    }
  }, [stop]);

  return { testing, error, test };
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { logger } from '@/shared/lib/logger';

const log = logger.child({ component: 'camera-preview' });

export interface CameraPreviewApi {
  stream: MediaStream | null;
  active: boolean;
  error: string | null;
  start: (deviceId?: string) => Promise<void>;
  stop: () => void;
}

/** "Prévia" da câmera em Settings — own getUserMedia stream, separate from
 * useCamera.ts (which is what a call actually publishes). Starting never
 * touches room.localParticipant, and stop() — on click, on unmount, or right
 * before a new start() — always stops every track, or the camera's own
 * hardware light stays on after leaving the page. */
export function useCameraPreview(): CameraPreviewApi {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stop = useCallback(() => {
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;
    setStream(null);
  }, []);

  const start = useCallback(async (deviceId?: string) => {
    stop();
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Seu navegador não suporta pré-visualizar a câmera.');
      return;
    }
    try {
      // 'default' is a real value getActiveDevice() can return (LiveKit's
      // own sentinel for "no explicit choice yet"), not an actual device id
      // — passing it as an exact constraint throws OverconstrainedError.
      const pick = deviceId && deviceId !== 'default' ? { deviceId: { exact: deviceId } } : true;
      const next = await navigator.mediaDevices.getUserMedia({ video: pick });
      streamRef.current = next;
      setStream(next);
    } catch (err) {
      log.warn('Failed to start camera preview', { err: String(err) });
      const name = (err as DOMException)?.name;
      const denied = name === 'NotAllowedError' || name === 'NotFoundError';
      setError(denied ? 'Não foi possível acessar a câmera.' : 'Não foi possível pré-visualizar a câmera agora.');
    }
  }, [stop]);

  useEffect(() => () => stop(), [stop]);

  return { stream, active: stream !== null, error, start, stop };
}

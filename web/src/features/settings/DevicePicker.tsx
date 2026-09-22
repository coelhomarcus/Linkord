import { useEffect, useId, useRef } from 'react';
import type { Room } from 'livekit-client';
import { Label } from '@/shared/ui/primitives/label';
import { Button } from '@/shared/ui/primitives/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/primitives/select';
import { useMediaDevices } from './useMediaDevices';
import { useMicLevelMeter } from './useMicLevelMeter';
import { useSpeakerTest } from './useSpeakerTest';
import { useCameraPreview } from './useCameraPreview';

const STATUS_TEXT: Record<'unsupported' | 'permission-denied' | 'no-devices', string> = {
  unsupported: 'Seu navegador não permite escolher dispositivo aqui.',
  'permission-denied': 'Permissão negada. Habilite o acesso nas configurações do navegador pra este site.',
  'no-devices': 'Nenhum dispositivo encontrado.',
};

/** The three "am I actually picking the right device" checks (plano §8.3,
 * melhorias P2) — each opens its own getUserMedia stream, never touches
 * room.localParticipant (a call's own track), starts only on this button and
 * stops on it, on unmount, or the moment the picked device changes. */
function MicTest({ deviceId }: { deviceId: string | undefined }) {
  const meter = useMicLevelMeter();
  useEffect(() => {
    if (meter.active) void meter.start(deviceId);
    // only reacting to the device changing — re-applies to whatever's now selected
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId]);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="xs" className="flex-none" onClick={() => (meter.active ? meter.stop() : void meter.start(deviceId))}>
          <span>{meter.active ? 'Parar teste' : 'Testar microfone'}</span>
        </Button>
        {meter.active && (
          <div
            role="meter"
            aria-label="Nível do microfone"
            aria-valuenow={Math.round(meter.level * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            className="h-1.5 w-full max-w-32 flex-1 overflow-hidden rounded-full bg-bg-hover"
          >
            <div className="h-full rounded-full bg-green transition-[width] duration-75" style={{ width: `${Math.round(meter.level * 100)}%` }} />
          </div>
        )}
      </div>
      {meter.error && <p role="alert" className="text-label text-red">{meter.error}</p>}
    </div>
  );
}

function SpeakerTestButton({ deviceId }: { deviceId: string | undefined }) {
  const { testing, error, test } = useSpeakerTest();
  return (
    <div className="flex flex-col gap-1.5">
      <Button type="button" variant="outline" size="xs" className="self-start" disabled={testing} onClick={() => void test(deviceId)}>
        <span>{testing ? 'Tocando…' : 'Testar'}</span>
      </Button>
      {error && <p role="alert" className="text-label text-red">{error}</p>}
    </div>
  );
}

function CameraPreview({ deviceId }: { deviceId: string | undefined }) {
  const preview = useCameraPreview();
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (preview.active) void preview.start(deviceId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = preview.stream;
  }, [preview.stream]);

  return (
    <div className="flex flex-col gap-1.5">
      <Button type="button" variant="outline" size="xs" className="self-start" onClick={() => (preview.active ? preview.stop() : void preview.start(deviceId))}>
        <span>{preview.active ? 'Parar prévia' : 'Ativar prévia'}</span>
      </Button>
      {preview.active && (
        // eslint-disable-next-line jsx-a11y/media-has-caption -- a live self-preview, not media content
        <video ref={videoRef} autoPlay muted playsInline className="aspect-video w-full max-w-56 rounded-md bg-black object-cover" />
      )}
      {preview.error && <p role="alert" className="text-label text-red">{preview.error}</p>}
    </div>
  );
}

export function DevicePicker({ label, room, kind }: { label: string; room: Room; kind: MediaDeviceKind }) {
  const { devices, activeDeviceId, status, switching, error, selectDevice, requestPermission } = useMediaDevices(room, kind);
  const controlId = useId();
  const helpId = useId();

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={controlId} className="text-body font-medium text-text-primary">{label}</Label>
      {status === 'permission-needed' ? (
        <Button id={controlId} type="button" variant="outline" size="sm" className="self-start" aria-describedby={helpId} onClick={() => requestPermission()}>
          <span>Permitir acesso pra ver os nomes dos dispositivos</span>
        </Button>
      ) : status === 'unsupported' || status === 'permission-denied' ? (
        // Asking again wouldn't help in either case — browsers don't
        // re-prompt once denied, and there's nothing to prompt for at all
        // when the API itself isn't available.
        <p id={controlId} className="text-body text-text-muted">{STATUS_TEXT[status]}</p>
      ) : (
        <Select value={activeDeviceId} onValueChange={(v) => v && selectDevice(v)} disabled={devices.length === 0 || switching}>
          <SelectTrigger id={controlId} aria-describedby={helpId} className="w-full text-text-muted">
            <SelectValue>{() => devices.find((d) => d.deviceId === activeDeviceId)?.label || 'Padrão do sistema'}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {devices.map((d) => (
              <SelectItem key={d.deviceId} value={d.deviceId}>{d.label || d.deviceId}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {status === 'no-devices' && <p className="text-label text-text-muted">{STATUS_TEXT['no-devices']}</p>}
      <p id={helpId} className="text-label text-text-muted">A troca vale na hora, mesmo durante uma chamada.</p>
      {error && <p role="alert" className="text-label text-red">{error}</p>}

      {status === 'ready' && kind === 'audioinput' && <MicTest deviceId={activeDeviceId} />}
      {status === 'ready' && kind === 'audiooutput' && <SpeakerTestButton deviceId={activeDeviceId} />}
      {status === 'ready' && kind === 'videoinput' && <CameraPreview deviceId={activeDeviceId} />}
    </div>
  );
}

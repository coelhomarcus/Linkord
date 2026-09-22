import { useId } from 'react';
import type { Room } from 'livekit-client';
import { Label } from '@/shared/ui/primitives/label';
import { Button } from '@/shared/ui/primitives/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/primitives/select';
import { useMediaDevices } from './useMediaDevices';

const STATUS_TEXT: Record<'unsupported' | 'permission-denied' | 'no-devices', string> = {
  unsupported: 'Seu navegador não permite escolher dispositivo aqui.',
  'permission-denied': 'Permissão negada. Habilite o acesso nas configurações do navegador pra este site.',
  'no-devices': 'Nenhum dispositivo encontrado.',
};

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
    </div>
  );
}

import { useId } from 'react';
import type { Room } from 'livekit-client';
import { Label } from '@/shared/ui/primitives/label';
import { Button } from '@/shared/ui/primitives/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/primitives/select';
import { useMediaDevices } from './useMediaDevices';

export function DevicePicker({ label, room, kind }: { label: string; room: Room; kind: MediaDeviceKind }) {
  const { devices, activeDeviceId, permissionNeeded, selectDevice, requestPermission } = useMediaDevices(room, kind);
  const controlId = useId();
  const helpId = useId();

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={controlId} className="text-body font-medium text-text-primary">{label}</Label>
      {permissionNeeded ? (
        <Button id={controlId} type="button" variant="outline" size="sm" className="self-start" aria-describedby={helpId} onClick={() => requestPermission()}>
          <span>Permitir acesso pra ver os nomes dos dispositivos</span>
        </Button>
      ) : (
        <Select value={activeDeviceId} onValueChange={(v) => v && selectDevice(v)} disabled={devices.length === 0}>
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
      <p id={helpId} className="text-label text-text-muted">A troca vale na hora, mesmo durante uma chamada.</p>
    </div>
  );
}

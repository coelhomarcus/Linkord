import { useCallback, useEffect, useState } from 'react';
import { Room } from 'livekit-client';
import type { Room as LKRoom } from 'livekit-client';

export interface DeviceOption {
  deviceId: string;
  label: string;
}

export interface MediaDevicesApi {
  devices: DeviceOption[];
  activeDeviceId: string | undefined;
  /** true quando a lista veio sem rotulo (navegador so mostra o nome real
   * do dispositivo depois de uma permissao concedida) — mostra um botao
   * "Permitir acesso" em vez de pedir a permissao sozinho (evita um prompt
   * de camera/mic surpresa so por abrir os Ajustes). */
  permissionNeeded: boolean;
  selectDevice: (deviceId: string) => Promise<void>;
  requestPermission: () => Promise<void>;
}

/** Seletor de dispositivo de audio/video — usa a API do proprio livekit-client
 * (Room.getLocalDevices/room.getActiveDevice/switchActiveDevice) em vez de
 * navigator.mediaDevices cru. Troca de dispositivo e aplicada na hora, mesmo
 * com a track ja publicada (o LiveKit troca o MediaStreamTrack por baixo). */
export function useMediaDevices(room: LKRoom, kind: MediaDeviceKind): MediaDevicesApi {
  const [devices, setDevices] = useState<DeviceOption[]>([]);
  const [activeDeviceId, setActiveDeviceId] = useState<string | undefined>(undefined);
  const [permissionNeeded, setPermissionNeeded] = useState(false);

  const refresh = useCallback(async (requestPermissions: boolean) => {
    const list = await Room.getLocalDevices(kind, requestPermissions);
    setDevices(list.map((d) => ({ deviceId: d.deviceId, label: d.label })));
    setPermissionNeeded(list.length > 0 && list.every((d) => !d.label));
    setActiveDeviceId(room.getActiveDevice(kind));
  }, [room, kind]);

  // nunca pede permissao sozinho ao montar — so lista o que da pra listar
  // sem rotulo (ou nada, se o navegador exigir permissao pra ate isso).
  useEffect(() => { refresh(false); }, [refresh]);

  const selectDevice = useCallback(async (deviceId: string) => {
    await room.switchActiveDevice(kind, deviceId);
    setActiveDeviceId(deviceId);
  }, [room, kind]);

  const requestPermission = useCallback(() => refresh(true), [refresh]);

  return { devices, activeDeviceId, permissionNeeded, selectDevice, requestPermission };
}

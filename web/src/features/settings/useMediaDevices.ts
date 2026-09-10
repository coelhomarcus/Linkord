import { useCallback, useEffect, useRef, useState } from 'react';
import { Room } from 'livekit-client';
import type { Room as LKRoom } from 'livekit-client';
import { loadDevicePreference, saveDevicePreference } from './useDevicePreference';

export interface DeviceOption {
  deviceId: string;
  label: string;
}

export interface MediaDevicesApi {
  devices: DeviceOption[];
  activeDeviceId: string | undefined;
  permissionNeeded: boolean;
  selectDevice: (deviceId: string) => Promise<void>;
  requestPermission: () => Promise<void>;
}

export function useMediaDevices(room: LKRoom, kind: MediaDeviceKind): MediaDevicesApi {
  const [devices, setDevices] = useState<DeviceOption[]>([]);
  const [activeDeviceId, setActiveDeviceId] = useState<string | undefined>(undefined);
  const [permissionNeeded, setPermissionNeeded] = useState(false);
  const appliedSavedRef = useRef(false);

  const refresh = useCallback(async (requestPermissions: boolean) => {
    const list = await Room.getLocalDevices(kind, requestPermissions);
    setDevices(list.map((d) => ({ deviceId: d.deviceId, label: d.label })));
    setPermissionNeeded(list.length > 0 && list.every((d) => !d.label));

    if (!appliedSavedRef.current) {
      appliedSavedRef.current = true;
      const saved = loadDevicePreference(kind);
      if (saved && list.some((d) => d.deviceId === saved) && room.getActiveDevice(kind) !== saved) {
        try {
          await room.switchActiveDevice(kind, saved);
        } catch (err) {
          console.warn(`Falha ao aplicar ${kind} salvo`, err);
        }
      }
    }

    setActiveDeviceId(room.getActiveDevice(kind));
  }, [room, kind]);

  useEffect(() => { refresh(false); }, [refresh]);

  const selectDevice = useCallback(async (deviceId: string) => {
    await room.switchActiveDevice(kind, deviceId);
    setActiveDeviceId(deviceId);
    saveDevicePreference(kind, deviceId);
  }, [room, kind]);

  const requestPermission = useCallback(() => refresh(true), [refresh]);

  return { devices, activeDeviceId, permissionNeeded, selectDevice, requestPermission };
}

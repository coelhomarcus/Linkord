import { useCallback, useEffect, useRef, useState } from 'react';
import { Room } from 'livekit-client';
import type { Room as LKRoom } from 'livekit-client';
import { loadDevicePreference, saveDevicePreference } from './useDevicePreference';
import { logger } from '@/shared/lib/logger';

const log = logger.child({ component: 'devices' });

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
    // no navigator.mediaDevices (an insecure page, an unsupported browser): the
    // picker simply stays empty and disabled instead of throwing from an effect
    let list: MediaDeviceInfo[];
    try {
      list = await Room.getLocalDevices(kind, requestPermissions);
    } catch (err) {
      log.warn('Failed to list media devices', { kind, err: String(err) });
      return;
    }
    setDevices(list.map((d) => ({ deviceId: d.deviceId, label: d.label })));
    setPermissionNeeded(list.length > 0 && list.every((d) => !d.label));

    if (!appliedSavedRef.current) {
      appliedSavedRef.current = true;
      const saved = loadDevicePreference(kind);
      if (saved && list.some((d) => d.deviceId === saved) && room.getActiveDevice(kind) !== saved) {
        try {
          await room.switchActiveDevice(kind, saved);
        } catch (err) {
          log.warn('Failed to apply the saved media device', { kind, err: String(err) });
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

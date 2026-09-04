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
  /** true when the list came back with no labels (the browser only shows
   * real device names after permission is granted) — shows a "Grant
   * access" button instead of requesting permission on its own (avoids a
   * surprise camera/mic prompt just from opening Settings). */
  permissionNeeded: boolean;
  selectDevice: (deviceId: string) => Promise<void>;
  requestPermission: () => Promise<void>;
}

/** Audio/video device selector — uses livekit-client's own API
 * (Room.getLocalDevices/room.getActiveDevice/switchActiveDevice) instead of
 * raw navigator.mediaDevices. Device switches apply immediately, even with
 * the track already published (LiveKit swaps the MediaStreamTrack
 * underneath). */
export function useMediaDevices(room: LKRoom, kind: MediaDeviceKind): MediaDevicesApi {
  const [devices, setDevices] = useState<DeviceOption[]>([]);
  const [activeDeviceId, setActiveDeviceId] = useState<string | undefined>(undefined);
  const [permissionNeeded, setPermissionNeeded] = useState(false);
  // applies the saved preference at most once per hook instance — avoids
  // re-forcing it on every refresh() (e.g. triggered by requestPermission).
  const appliedSavedRef = useRef(false);

  const refresh = useCallback(async (requestPermissions: boolean) => {
    const list = await Room.getLocalDevices(kind, requestPermissions);
    setDevices(list.map((d) => ({ deviceId: d.deviceId, label: d.label })));
    setPermissionNeeded(list.length > 0 && list.every((d) => !d.label));

    if (!appliedSavedRef.current) {
      appliedSavedRef.current = true;
      const saved = loadDevicePreference(kind);
      // only apply a device id that's actually present right now — never
      // force-apply a stale/removed device.
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

  // never requests permission on its own when mounting — only lists what
  // it can list without a label (or nothing, if the browser requires
  // permission even for that).
  useEffect(() => { refresh(false); }, [refresh]);

  const selectDevice = useCallback(async (deviceId: string) => {
    await room.switchActiveDevice(kind, deviceId);
    setActiveDeviceId(deviceId);
    saveDevicePreference(kind, deviceId);
  }, [room, kind]);

  const requestPermission = useCallback(() => refresh(true), [refresh]);

  return { devices, activeDeviceId, permissionNeeded, selectDevice, requestPermission };
}

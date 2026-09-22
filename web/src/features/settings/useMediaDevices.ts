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

/** `ready`: normal picker. `unsupported`: no navigator.mediaDevices at all
 * (insecure context, old browser) — asking again would never help.
 * `permission-needed`: never asked, or the labels just aren't populated
 * yet. `permission-denied`: explicitly asked (requestPermission) and still
 * got nothing — also wouldn't help to ask again, the browser won't re-prompt.
 * `no-devices`: supported and permitted, but the list is genuinely empty. */
export type MediaDevicesStatus = 'ready' | 'unsupported' | 'permission-needed' | 'permission-denied' | 'no-devices';

export interface MediaDevicesApi {
  devices: DeviceOption[];
  activeDeviceId: string | undefined;
  status: MediaDevicesStatus;
  /** Set only while a selectDevice() call is in flight — disables the
   * picker so a second selection can't race the first. */
  switching: boolean;
  /** Recoverable message from the last failed switchActiveDevice, if any. */
  error: string | null;
  selectDevice: (deviceId: string) => Promise<void>;
  requestPermission: () => Promise<void>;
}

export function useMediaDevices(room: LKRoom, kind: MediaDeviceKind): MediaDevicesApi {
  const [devices, setDevices] = useState<DeviceOption[]>([]);
  const [activeDeviceId, setActiveDeviceId] = useState<string | undefined>(undefined);
  const [status, setStatus] = useState<MediaDevicesStatus>('permission-needed');
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const appliedSavedRef = useRef(false);
  const askedRef = useRef(false);

  const refresh = useCallback(async (requestPermissions: boolean) => {
    if (requestPermissions) askedRef.current = true;
    // No navigator.mediaDevices (an insecure page, an unsupported browser):
    // getLocalDevices itself throws trying to read it (enumerateDevices on
    // undefined) — caught below, same as any other listing failure.
    let list: MediaDeviceInfo[];
    try {
      list = await Room.getLocalDevices(kind, requestPermissions);
    } catch (err) {
      log.warn('Failed to list media devices', { kind, err: String(err) });
      // getLocalDevices only ever forces getUserMedia (which is what can
      // reject with the browser's own permission denial) when explicitly
      // asked to — a throw from the initial silent read means the API
      // itself isn't usable here, not that anyone said no to anything.
      setStatus(requestPermissions ? 'permission-denied' : 'unsupported');
      return;
    }
    setDevices(list.map((d) => ({ deviceId: d.deviceId, label: d.label })));

    const noLabels = list.length > 0 && list.every((d) => !d.label);
    if (noLabels) setStatus(askedRef.current ? 'permission-denied' : 'permission-needed');
    else if (list.length === 0) setStatus('no-devices');
    else setStatus('ready');

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

  // Unplugging/plugging hardware (or the OS switching a default device)
  // never used to reach this list at all — only the initial mount did.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices) return;
    const onDeviceChange = () => refresh(false);
    navigator.mediaDevices.addEventListener('devicechange', onDeviceChange);
    return () => navigator.mediaDevices.removeEventListener('devicechange', onDeviceChange);
  }, [refresh]);

  const selectDevice = useCallback(async (deviceId: string) => {
    setError(null);
    setSwitching(true);
    try {
      await room.switchActiveDevice(kind, deviceId);
      setActiveDeviceId(deviceId);
      saveDevicePreference(kind, deviceId);
    } catch (err) {
      log.warn('Failed to switch active device', { kind, err: String(err) });
      setError('Não foi possível trocar o dispositivo. Tente de novo.');
    } finally {
      setSwitching(false);
    }
  }, [room, kind]);

  const requestPermission = useCallback(() => refresh(true), [refresh]);

  return { devices, activeDeviceId, status, switching, error, selectDevice, requestPermission };
}

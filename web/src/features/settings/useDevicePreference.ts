
const KEY_PREFIX = 'ss-device-';

export function loadDevicePreference(kind: MediaDeviceKind): string | null {
  return localStorage.getItem(KEY_PREFIX + kind);
}

export function saveDevicePreference(kind: MediaDeviceKind, deviceId: string): void {
  localStorage.setItem(KEY_PREFIX + kind, deviceId);
}

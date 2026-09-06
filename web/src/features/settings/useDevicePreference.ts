/** Selected mic/camera/speaker device id, persisted in localStorage — kept
 * separate from useMediaDevices.ts so every hook instance (SettingsModal's
 * DevicePicker AND LeftSidebar's mic picker) restores the same saved
 * choice. Key: `ss-device-${kind}`, one per MediaDeviceKind. */

const KEY_PREFIX = 'ss-device-';

export function loadDevicePreference(kind: MediaDeviceKind): string | null {
  return localStorage.getItem(KEY_PREFIX + kind);
}

export function saveDevicePreference(kind: MediaDeviceKind, deviceId: string): void {
  localStorage.setItem(KEY_PREFIX + kind, deviceId);
}

/** "Mostrar apenas cameras e transmissoes" toggle (call grid) — persisted
 * in localStorage, same load/save pattern as useSettingsPreference.ts. */

const KEY = 'ss-hide-audio-only-tiles';

export function loadHideAudioOnlyTiles(): boolean {
  return localStorage.getItem(KEY) === '1';
}

export function saveHideAudioOnlyTiles(value: boolean): void {
  localStorage.setItem(KEY, value ? '1' : '0');
}

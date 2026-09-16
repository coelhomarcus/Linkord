const KEY = 'ss-noise-suppression';

export function loadNoiseSuppression(): boolean {
  return localStorage.getItem(KEY) === '1';
}

export function saveNoiseSuppression(value: boolean): void {
  localStorage.setItem(KEY, value ? '1' : '0');
}

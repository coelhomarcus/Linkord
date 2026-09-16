const KEY = 'ss-background-blur';

export function loadBackgroundBlur(): boolean {
  return localStorage.getItem(KEY) === '1';
}

export function saveBackgroundBlur(value: boolean): void {
  localStorage.setItem(KEY, value ? '1' : '0');
}

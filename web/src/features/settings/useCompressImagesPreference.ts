const KEY = 'ss-compress-images';

export function loadCompressImages(): boolean {
  return localStorage.getItem(KEY) !== '0';
}

export function saveCompressImages(value: boolean): void {
  localStorage.setItem(KEY, value ? '1' : '0');
}

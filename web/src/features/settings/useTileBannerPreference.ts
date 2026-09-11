const KEY = 'ss-show-tile-banners';

export function loadShowTileBanners(): boolean {
  return localStorage.getItem(KEY) !== '0';
}

export function saveShowTileBanners(value: boolean): void {
  localStorage.setItem(KEY, value ? '1' : '0');
}

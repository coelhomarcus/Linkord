/** Upload bitrate (screen and camera), persisted in localStorage —
 * separate from the profile (own key, ss-quality) since it's a technical
 * preference, not an identity one. */

export type Quality = 'standard' | 'reduced' | 'minimum';

/** livekit-client's VideoEncoding shape — declared here (without importing
 * the lib in this folder) to keep settings/ isolated from other features. */
export interface QualityEncoding {
  maxBitrate: number;
  maxFramerate: number;
}

export const QUALITY_ENCODINGS: Record<Quality, QualityEncoding> = {
  standard: { maxBitrate: 2_500_000, maxFramerate: 30 },
  reduced: { maxBitrate: 1_000_000, maxFramerate: 24 },
  minimum: { maxBitrate: 500_000, maxFramerate: 15 },
};

export const QUALITY_LABELS: Record<Quality, string> = {
  standard: 'Padrão (2,5 Mbps)',
  reduced: 'Reduzida (1 Mbps)',
  minimum: 'Mínima (500 Kbps)',
};

const KEY = 'ss-quality';

export function loadQuality(): Quality {
  const v = localStorage.getItem(KEY);
  return v === 'reduced' || v === 'minimum' ? v : 'standard';
}

export function saveQuality(q: Quality): void {
  localStorage.setItem(KEY, q);
}

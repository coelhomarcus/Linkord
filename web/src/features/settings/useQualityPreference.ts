/** Upload bitrate (screen and camera), persisted in localStorage —
 * separate from the profile (own key, ss-quality) since it's a technical
 * preference, not an identity one. */

export type Quality = 'high' | 'standard' | 'reduced' | 'minimum';

/** livekit-client's VideoEncoding shape — declared here (without importing
 * the lib in this folder) to keep settings/ isolated from other features. */
export interface QualityEncoding {
  maxBitrate: number;
  maxFramerate: number;
}

export const QUALITY_ENCODINGS: Record<Quality, QualityEncoding> = {
  // For motion-heavy content (video, games) — screen capture requests this
  // framerate too (see useScreenShare.ts), not just the publish cap.
  high: { maxBitrate: 6_000_000, maxFramerate: 60 },
  standard: { maxBitrate: 2_500_000, maxFramerate: 30 },
  reduced: { maxBitrate: 1_000_000, maxFramerate: 24 },
  minimum: { maxBitrate: 500_000, maxFramerate: 15 },
};

export const QUALITY_LABELS: Record<Quality, string> = {
  high: 'Alta — 60 FPS (6 Mbps)',
  standard: 'Padrão (2,5 Mbps)',
  reduced: 'Reduzida (1 Mbps)',
  minimum: 'Mínima (500 Kbps)',
};

const KEY = 'ss-quality';

export function loadQuality(): Quality {
  const v = localStorage.getItem(KEY);
  return v === 'high' || v === 'reduced' || v === 'minimum' ? v : 'standard';
}

export function saveQuality(q: Quality): void {
  localStorage.setItem(KEY, q);
}

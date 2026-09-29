import { DEFAULT_SHARE_QUALITY, isShareQualityId } from '@/features/calls/shareQualityPresets';
import type { ShareQualityId } from '@/features/calls/shareQualityPresets';

const KEY = 'ss-share-quality';

// Applies the next time a screen-share capture starts (a fresh "Compartilhar
// tela", or "Trocar fonte" while already sharing) — not live, mid-share: the
// browser has no API to reduce/raise an in-progress getDisplayMedia capture's
// resolution without a new prompt, so there is nothing to "apply now" to.
export function loadShareQuality(): ShareQualityId {
  const raw = localStorage.getItem(KEY);
  return raw && isShareQualityId(raw) ? raw : DEFAULT_SHARE_QUALITY;
}

export function saveShareQuality(value: ShareQualityId): void {
  localStorage.setItem(KEY, value);
}

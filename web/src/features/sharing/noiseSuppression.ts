import type { LocalAudioTrack } from 'livekit-client';

/**
 * AI-based background noise removal (Krisp), applied as a track processor on
 * top of the raw mic capture. `@livekit/krisp-noise-filter` bundles a ~6MB
 * WASM model, so it's always dynamically imported here — never a static
 * import elsewhere — to keep it out of the initial page bundle; it only
 * downloads the first time a mic is actually activated with this on.
 */
async function loadKrispFilter() {
  return import('@livekit/krisp-noise-filter');
}

/** Applies the filter to an already-created (not yet necessarily published)
 * local audio track. Never throws — a device/browser that can't run it
 * (e.g. no AudioWorklet support) just keeps the unprocessed mic track,
 * same fallback spirit as the rest of useMicrophone.ts's error handling. */
export async function applyNoiseSuppression(track: LocalAudioTrack): Promise<boolean> {
  try {
    const { KrispNoiseFilter, isKrispNoiseFilterSupported } = await loadKrispFilter();
    if (!isKrispNoiseFilterSupported()) return false;
    await track.setProcessor(KrispNoiseFilter());
    return true;
  } catch (err) {
    console.warn('[mic] falha ao ativar supressao de ruido, seguindo sem ela:', err);
    return false;
  }
}

/** Removes whatever processor is set (a no-op if none is) — used when the
 * user turns the setting off mid-call. */
export async function removeNoiseSuppression(track: LocalAudioTrack): Promise<void> {
  try {
    await track.stopProcessor();
  } catch (err) {
    console.warn('[mic] falha ao desativar supressao de ruido:', err);
  }
}

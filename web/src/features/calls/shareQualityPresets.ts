import { ScreenSharePresets } from 'livekit-client';
import type { VideoEncoding } from 'livekit-client';

export type ShareQualityId = 'standard' | 'sharp' | 'smooth';

export interface ShareQualityPreset {
  label: string;
  resolution: { width: number; height: number; frameRate: number };
  encoding: VideoEncoding;
}

// Three real, named LiveKit presets — never a hand-rolled bitrate/fps pair —
// covering the two axes that actually trade off for screen content: sharper
// still text (slides, docs) vs. smoother motion (video, games). This SDK
// version has no 1080p/60 preset, so "smooth" trades resolution for frame
// rate instead of inventing an unvalidated encoding.
export const SHARE_QUALITY_PRESETS: Record<ShareQualityId, ShareQualityPreset> = {
  standard: {
    label: 'Padrão (1080p, 30 fps)',
    resolution: { width: 1920, height: 1080, frameRate: 30 },
    encoding: ScreenSharePresets.h1080fps30.encoding,
  },
  sharp: {
    label: 'Nítida, pouco movimento (1080p, 15 fps)',
    resolution: { width: 1920, height: 1080, frameRate: 15 },
    encoding: ScreenSharePresets.h1080fps15.encoding,
  },
  smooth: {
    label: 'Fluida, para vídeo ou jogos (720p, 30 fps)',
    resolution: { width: 1280, height: 720, frameRate: 30 },
    encoding: ScreenSharePresets.h720fps30.encoding,
  },
};

export const DEFAULT_SHARE_QUALITY: ShareQualityId = 'standard';

export function isShareQualityId(value: string): value is ShareQualityId {
  return value in SHARE_QUALITY_PRESETS;
}

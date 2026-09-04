/**
 * Detects embeddable links in chat (YouTube, Twitch, direct media). Only
 * recognizes fixed/known formats and extracts just the ID via regex — the
 * embedded iframe's URL is always built by us (fixed domain), never passing
 * the user's raw URL to `src`, so there's no injection risk even trusting
 * text typed by any participant.
 */

export type EmbedKind = 'youtube' | 'twitch-channel' | 'twitch-vod' | 'twitch-clip' | 'video' | 'audio' | 'image' | 'link';

export interface DetectedEmbed {
  kind: EmbedKind;
  url: string;
  youtubeId?: string;
  twitchChannel?: string;
  twitchVideoId?: string;
  twitchClipSlug?: string;
}

const URL_RE = /https?:\/\/[^\s<>"']+/gi;

const YOUTUBE_RE = /^https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/i;
const TWITCH_CLIP_RE = /^https?:\/\/(?:clips\.twitch\.tv\/([A-Za-z0-9_-]+)|(?:www\.)?twitch\.tv\/[A-Za-z0-9_]+\/clip\/([A-Za-z0-9_-]+))/i;
const TWITCH_VOD_RE = /^https?:\/\/(?:www\.)?twitch\.tv\/videos\/(\d+)/i;
const TWITCH_CHANNEL_RE = /^https?:\/\/(?:www\.)?twitch\.tv\/([A-Za-z0-9_]{3,25})\/?(?:[?#].*)?$/i;
const VIDEO_EXT_RE = /\.(mp4|webm|mov|m4v)(?:[?#]|$)/i;
const AUDIO_EXT_RE = /\.(mp3|wav|ogg|m4a|flac|aac)(?:[?#]|$)/i;
const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|avif|svg)(?:[?#]|$)/i;
// known image proxies with no extension in the path (e.g. a Google Images
// thumbnail, https://encrypted-tbn0.gstatic.com/images?q=tbn:...)
const IMAGE_HOST_RE = /^https?:\/\/(?:encrypted-)?tbn\d*\.gstatic\.com\//i;

export function extractUrls(text: string): string[] {
  return text.match(URL_RE) ?? [];
}

export function detectEmbed(url: string): DetectedEmbed | null {
  let m = YOUTUBE_RE.exec(url);
  if (m) return { kind: 'youtube', url, youtubeId: m[1] };

  m = TWITCH_CLIP_RE.exec(url);
  if (m) return { kind: 'twitch-clip', url, twitchClipSlug: m[1] || m[2] };

  m = TWITCH_VOD_RE.exec(url);
  if (m) return { kind: 'twitch-vod', url, twitchVideoId: m[1] };

  m = TWITCH_CHANNEL_RE.exec(url);
  if (m) return { kind: 'twitch-channel', url, twitchChannel: m[1] };

  if (VIDEO_EXT_RE.test(url)) return { kind: 'video', url };
  if (AUDIO_EXT_RE.test(url)) return { kind: 'audio', url };
  if (IMAGE_EXT_RE.test(url) || IMAGE_HOST_RE.test(url)) return { kind: 'image', url };

  // fallback: any remaining http(s) link becomes a generic card with Open
  // Graph metadata (fetched server-side, see GenericEmbed.tsx and
  // server/src/modules/link-preview/linkPreview.ts — the browser can't
  // fetch this directly due to CORS). Must be the LAST check, after every
  // known format.
  return { kind: 'link', url };
}

/** First embeddable link in a message (only one, so chat isn't flooded with
 * players when someone sends several links in the same message). */
export function firstEmbed(text: string): DetectedEmbed | null {
  for (const url of extractUrls(text)) {
    const embed = detectEmbed(url);
    if (embed) return embed;
  }
  return null;
}

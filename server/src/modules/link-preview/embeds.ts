// ---------------------------------------------------------------------------
// Deteccao de links embutiveis — espelha web/src/shared/lib/chatEmbeds.ts
// (mesmos regex, mesma ordem de checagem). So existe aqui pra classificar
// mensagens na aba Midias dos Ajustes (server/src/modules/media.ts) SEM
// devolver pro cliente um monte de mensagem-com-link-qualquer que na hora de
// renderizar nao vira embed nenhum (a maioria dos links do dia a dia nao
// casa com nenhum desses formatos). O cliente continua sendo quem decide
// como desenhar cada tipo (LinkPreview.tsx) — isso aqui so filtra/anota,
// nunca monta HTML/iframe. Se mudar um regex de um lado, muda do outro
// tambem.
// ---------------------------------------------------------------------------

const URL_RE = /https?:\/\/[^\s<>"']+/gi;

const YOUTUBE_RE = /^https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/i;
const TWITCH_CLIP_RE = /^https?:\/\/(?:clips\.twitch\.tv\/([A-Za-z0-9_-]+)|(?:www\.)?twitch\.tv\/[A-Za-z0-9_]+\/clip\/([A-Za-z0-9_-]+))/i;
const TWITCH_VOD_RE = /^https?:\/\/(?:www\.)?twitch\.tv\/videos\/(\d+)/i;
const TWITCH_CHANNEL_RE = /^https?:\/\/(?:www\.)?twitch\.tv\/([A-Za-z0-9_]{3,25})\/?(?:[?#].*)?$/i;
const VIDEO_EXT_RE = /\.(mp4|webm|mov|m4v)(?:[?#]|$)/i;
const AUDIO_EXT_RE = /\.(mp3|wav|ogg|m4a|flac|aac)(?:[?#]|$)/i;
const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|avif|svg)(?:[?#]|$)/i;
const IMAGE_HOST_RE = /^https?:\/\/(?:encrypted-)?tbn\d*\.gstatic\.com\//i;

export type DetectedEmbed =
  | { kind: 'youtube'; url: string; youtubeId: string }
  | { kind: 'twitch-clip'; url: string; twitchClipSlug: string }
  | { kind: 'twitch-vod'; url: string; twitchVideoId: string }
  | { kind: 'twitch-channel'; url: string; twitchChannel: string }
  | { kind: 'video'; url: string }
  | { kind: 'audio'; url: string }
  | { kind: 'image'; url: string }
  | { kind: 'link'; url: string };

export function extractUrls(text: string): string[] {
  return text.match(URL_RE) || [];
}

export function detectEmbed(url: string): DetectedEmbed {
  let m = YOUTUBE_RE.exec(url);
  if (m) return { kind: 'youtube', url, youtubeId: m[1]! };

  m = TWITCH_CLIP_RE.exec(url);
  if (m) return { kind: 'twitch-clip', url, twitchClipSlug: (m[1] || m[2])! };

  m = TWITCH_VOD_RE.exec(url);
  if (m) return { kind: 'twitch-vod', url, twitchVideoId: m[1]! };

  m = TWITCH_CHANNEL_RE.exec(url);
  if (m) return { kind: 'twitch-channel', url, twitchChannel: m[1]! };

  if (VIDEO_EXT_RE.test(url)) return { kind: 'video', url };
  if (AUDIO_EXT_RE.test(url)) return { kind: 'audio', url };
  if (IMAGE_EXT_RE.test(url) || IMAGE_HOST_RE.test(url)) return { kind: 'image', url };

  // espelha o fallback de chatEmbeds.ts: qualquer link restante ainda conta
  // como "embutivel" (o card generico com Open Graph, ver
  // web/src/shared/GenericEmbed.tsx) — sem isso a aba Midias > Embeds
  // ficaria sem esses links, so com YouTube/Twitch/midia direta.
  return { kind: 'link', url };
}

/** Primeiro link embutivel de um texto — mesma regra do chat (so um por
 * mensagem, ver firstEmbed em chatEmbeds.ts). */
export function firstEmbed(text: string): DetectedEmbed | null {
  for (const url of extractUrls(String(text || ''))) {
    const embed = detectEmbed(url);
    if (embed) return embed;
  }
  return null;
}

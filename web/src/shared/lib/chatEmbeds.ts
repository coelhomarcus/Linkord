/**
 * Deteccao de links embutiveis no chat (YouTube, Twitch, midia direta).
 * So reconhece formatos fixos/conhecidos e extrai apenas o ID via regex —
 * a URL do iframe embutido e sempre montada por nos (dominio fixo), nunca
 * repassando a URL crua do usuario pro `src`, entao nao ha risco de
 * injecao mesmo confiando em texto digitado por qualquer participante.
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
// proxies de imagem conhecidos que nao tem extensao no path (ex.: thumbnail
// do Google Imagens, https://encrypted-tbn0.gstatic.com/images?q=tbn:...)
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

  // fallback: qualquer link http(s) restante vira um card generico com
  // metadata Open Graph (busca no servidor, ver GenericEmbed.tsx e
  // server/linkPreview.js — o navegador nao pode buscar isso direto por
  // CORS). Precisa ser o ULTIMO checado, depois de todo formato conhecido.
  return { kind: 'link', url };
}

/** Primeiro link embutivel de uma mensagem (so um, pra nao lotar o chat de
 * player quando alguem manda varios links na mesma mensagem). */
export function firstEmbed(text: string): DetectedEmbed | null {
  for (const url of extractUrls(text)) {
    const embed = detectEmbed(url);
    if (embed) return embed;
  }
  return null;
}

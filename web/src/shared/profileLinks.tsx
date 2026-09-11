import type { ComponentType, CSSProperties } from 'react';
import { Link2 } from 'lucide-react';
import {
  SiBehance, SiBluesky, SiDiscord, SiDribbble, SiEpicgames, SiFacebook, SiGithub, SiInstagram,
  SiKick, SiPinterest, SiReddit, SiSnapchat, SiSoundcloud, SiSpotify, SiSteam, SiTelegram,
  SiThreads, SiTiktok, SiTwitch, SiVk, SiWhatsapp, SiX, SiYoutube,
} from 'react-icons/si';
import { FaLinkedin, FaXbox } from 'react-icons/fa6';
import { colorFor } from './Avatar';

export type LinkKind =
  | 'youtube' | 'twitter' | 'twitch' | 'instagram' | 'github' | 'linkedin' | 'tiktok' | 'spotify' | 'discord'
  | 'steam' | 'reddit' | 'facebook' | 'threads' | 'bluesky' | 'telegram' | 'soundcloud' | 'pinterest'
  | 'snapchat' | 'kick' | 'epicgames' | 'xbox' | 'behance' | 'dribbble' | 'vk' | 'whatsapp'
  | 'generic';

export interface LinkInfo {
  url: string;
  kind: LinkKind;
  label: string;
}

function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

export function linkInfo(rawUrl: string): LinkInfo | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, '');

  if (hostMatches(host, 'youtube.com') || host === 'youtu.be') return { url: rawUrl, kind: 'youtube', label: 'YouTube' };
  if (hostMatches(host, 'twitter.com') || hostMatches(host, 'x.com')) return { url: rawUrl, kind: 'twitter', label: 'X / Twitter' };
  if (hostMatches(host, 'twitch.tv')) return { url: rawUrl, kind: 'twitch', label: 'Twitch' };
  if (hostMatches(host, 'instagram.com')) return { url: rawUrl, kind: 'instagram', label: 'Instagram' };
  if (hostMatches(host, 'github.com')) return { url: rawUrl, kind: 'github', label: 'GitHub' };
  if (hostMatches(host, 'linkedin.com')) return { url: rawUrl, kind: 'linkedin', label: 'LinkedIn' };
  if (hostMatches(host, 'tiktok.com')) return { url: rawUrl, kind: 'tiktok', label: 'TikTok' };
  if (hostMatches(host, 'spotify.com')) return { url: rawUrl, kind: 'spotify', label: 'Spotify' };
  if (hostMatches(host, 'discord.com') || hostMatches(host, 'discord.gg')) return { url: rawUrl, kind: 'discord', label: 'Discord' };
  if (hostMatches(host, 'steamcommunity.com') || hostMatches(host, 'steampowered.com')) return { url: rawUrl, kind: 'steam', label: 'Steam' };
  if (hostMatches(host, 'reddit.com')) return { url: rawUrl, kind: 'reddit', label: 'Reddit' };
  if (hostMatches(host, 'facebook.com') || hostMatches(host, 'fb.com')) return { url: rawUrl, kind: 'facebook', label: 'Facebook' };
  if (hostMatches(host, 'threads.net')) return { url: rawUrl, kind: 'threads', label: 'Threads' };
  if (hostMatches(host, 'bsky.app')) return { url: rawUrl, kind: 'bluesky', label: 'Bluesky' };
  if (hostMatches(host, 'telegram.org') || hostMatches(host, 'telegram.me') || host === 't.me') return { url: rawUrl, kind: 'telegram', label: 'Telegram' };
  if (hostMatches(host, 'soundcloud.com')) return { url: rawUrl, kind: 'soundcloud', label: 'SoundCloud' };
  if (hostMatches(host, 'pinterest.com')) return { url: rawUrl, kind: 'pinterest', label: 'Pinterest' };
  if (hostMatches(host, 'snapchat.com')) return { url: rawUrl, kind: 'snapchat', label: 'Snapchat' };
  if (hostMatches(host, 'kick.com')) return { url: rawUrl, kind: 'kick', label: 'Kick' };
  if (hostMatches(host, 'epicgames.com')) return { url: rawUrl, kind: 'epicgames', label: 'Epic Games' };
  if (hostMatches(host, 'xbox.com')) return { url: rawUrl, kind: 'xbox', label: 'Xbox' };
  if (hostMatches(host, 'behance.net')) return { url: rawUrl, kind: 'behance', label: 'Behance' };
  if (hostMatches(host, 'dribbble.com')) return { url: rawUrl, kind: 'dribbble', label: 'Dribbble' };
  if (hostMatches(host, 'vk.com')) return { url: rawUrl, kind: 'vk', label: 'VK' };
  if (hostMatches(host, 'whatsapp.com') || host === 'wa.me') return { url: rawUrl, kind: 'whatsapp', label: 'WhatsApp' };
  return { url: rawUrl, kind: 'generic', label: host || 'Link' };
}

const BRAND_ICONS: Record<Exclude<LinkKind, 'generic'>, ComponentType<{ size?: number }>> = {
  youtube: SiYoutube,
  twitter: SiX,
  twitch: SiTwitch,
  instagram: SiInstagram,
  github: SiGithub,
  linkedin: FaLinkedin,
  tiktok: SiTiktok,
  spotify: SiSpotify,
  discord: SiDiscord,
  steam: SiSteam,
  reddit: SiReddit,
  facebook: SiFacebook,
  threads: SiThreads,
  bluesky: SiBluesky,
  telegram: SiTelegram,
  soundcloud: SiSoundcloud,
  pinterest: SiPinterest,
  snapchat: SiSnapchat,
  kick: SiKick,
  epicgames: SiEpicgames,
  xbox: FaXbox,
  behance: SiBehance,
  dribbble: SiDribbble,
  vk: SiVk,
  whatsapp: SiWhatsapp,
};

export function BrandIcon({ kind }: { kind: LinkKind }) {
  if (kind === 'generic') return <Link2 aria-hidden="true" size={17} />;
  const Icon = BRAND_ICONS[kind];
  return <Icon size={17} />;
}

// 16:9 — same shape a call tile fills via `background-size: cover` (see
// Tile.tsx), so a banner crops/displays consistently everywhere it shows up
// (profile card, settings, in-call background) instead of each spot picking
// its own ratio.
export const BANNER_ASPECT_RATIO = 16 / 9;

export function bannerStyle(user: { id: string; avatarColor: string; banner: string }): CSSProperties {
  const accent = colorFor(user.id, user.avatarColor);
  if (!user.banner) return { background: `linear-gradient(135deg, ${accent}, var(--color-bg-tertiary))` };
  return {
    backgroundImage: `linear-gradient(180deg, rgba(0,0,0,0.04), rgba(0,0,0,0.24)), url(${JSON.stringify(user.banner)})`,
    backgroundPosition: 'center',
    backgroundSize: 'cover',
  };
}

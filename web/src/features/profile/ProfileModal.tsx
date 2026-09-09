import { AtSign, BadgeCheck, ExternalLink, Link2 } from 'lucide-react';
import type { ComponentType, CSSProperties } from 'react';
import { useState } from 'react';
import {
  SiBehance, SiBluesky, SiDiscord, SiDribbble, SiEpicgames, SiFacebook, SiGithub, SiInstagram,
  SiKick, SiPinterest, SiReddit, SiSnapchat, SiSoundcloud, SiSpotify, SiSteam, SiTelegram,
  SiThreads, SiTiktok, SiTwitch, SiVk, SiWhatsapp, SiX, SiYoutube,
} from 'react-icons/si';
import { FaLinkedin, FaXbox } from 'react-icons/fa6';
import { Avatar, colorFor } from '@/shared/Avatar';
import { useRoom } from '@/state/RoomContext';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ImageLightbox } from '@/shared/ImageLightbox';
import type { PublicUser } from '@/types/protocol';

type LinkKind =
  | 'youtube' | 'twitter' | 'twitch' | 'instagram' | 'github' | 'linkedin' | 'tiktok' | 'spotify' | 'discord'
  | 'steam' | 'reddit' | 'facebook' | 'threads' | 'bluesky' | 'telegram' | 'soundcloud' | 'pinterest'
  | 'snapchat' | 'kick' | 'epicgames' | 'xbox' | 'behance' | 'dribbble' | 'vk' | 'whatsapp'
  | 'generic';

interface LinkInfo {
  url: string;
  kind: LinkKind;
  label: string;
}

function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

function linkInfo(rawUrl: string): LinkInfo | null {
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
  // steamcommunity.com (profiles/groups) and store.steampowered.com (a
  // specific game/app page) — both count as "a Steam link".
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

// every brand icon renders in the app's plain "white" text token — a wall
// of each platform's own color looked noisy next to everything else in the
// (otherwise monochrome) UI. react-icons/si covers most of these as flat
// single-color logos already shaped for exactly this; fa6 fills the two
// gaps si doesn't have (LinkedIn, Xbox).
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

function BrandIcon({ kind }: { kind: LinkKind }) {
  if (kind === 'generic') return <Link2 aria-hidden="true" size={17} />;
  const Icon = BRAND_ICONS[kind];
  return <Icon size={17} />;
}

function bannerStyle(user: PublicUser): CSSProperties {
  const accent = colorFor(user.id, user.avatarColor);
  if (!user.banner) return { background: `linear-gradient(135deg, ${accent}, var(--color-bg-tertiary))` };
  return {
    backgroundImage: `linear-gradient(180deg, rgba(0,0,0,0.04), rgba(0,0,0,0.24)), url(${JSON.stringify(user.banner)})`,
    backgroundPosition: 'center',
    backgroundSize: 'cover',
  };
}

interface ProfileModalProps {
  userId: string | null;
  onClose: () => void;
}

export function ProfileModal({ userId, onClose }: ProfileModalProps) {
  const { allUsers, onlineUserIds } = useRoom();
  const user = userId ? allUsers.get(userId) : null;
  const links = (user?.profileLinks ?? []).map(linkInfo).filter((item): item is LinkInfo => !!item);
  // shared by both avatar and banner — only one can be open at a time
  // anyway (it's a modal), and comparing against user.banner below tells
  // ImageLightbox which alt text to use.
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  return (
    <Dialog open={!!user} onOpenChange={(next) => { if (!next) onClose(); }}>
      {user && (
        <DialogContent className="max-w-[calc(100%-2rem)] overflow-hidden bg-bg-modal p-0 sm:max-w-130">
          <DialogTitle className="sr-only">Perfil de {user.displayName}</DialogTitle>
          {user.banner ? (
            <button
              type="button"
              aria-label="Ver banner em tela cheia"
              onClick={() => setLightboxSrc(user.banner)}
              className="block h-40 w-full cursor-zoom-in"
              style={bannerStyle(user)}
            />
          ) : (
            <div className="h-40 w-full" style={bannerStyle(user)} />
          )}
          <div className="px-6 pb-6">
            <div className="-mt-12 flex items-end gap-3">
              <div className="relative rounded-full bg-bg-modal p-1">
                {user.avatar ? (
                  <button
                    type="button"
                    aria-label="Ver foto de perfil em tela cheia"
                    onClick={() => setLightboxSrc(user.avatar)}
                    className="block cursor-zoom-in rounded-full focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    <Avatar id={user.id} name={user.displayName} avatar={user.avatar} avatarColor={user.avatarColor} size={92} />
                  </button>
                ) : (
                  <Avatar id={user.id} name={user.displayName} avatar={user.avatar} avatarColor={user.avatarColor} size={92} />
                )}
                {onlineUserIds.has(user.id) && (
                  <span className="absolute right-1 bottom-1 h-5 w-5 rounded-full border-2 border-bg-modal bg-green" />
                )}
              </div>
            </div>

            <div className="mt-3 flex min-w-0 flex-col gap-1">
              <h2 className="truncate text-display font-bold text-text-primary">{user.displayName}</h2>
              <div className="flex min-w-0 items-center gap-2">
                <p className="flex min-w-0 items-center gap-0.5 truncate text-label text-text-muted">
                  <AtSign size={14} className="flex-none" />
                  <span className="truncate">{user.username}</span>
                </p>
                {user.role === 'admin' && (
                  <span className="flex flex-none items-center gap-1 rounded-sm bg-blurple/15 px-1.5 py-0.5 text-caption font-medium text-blurple">
                    <BadgeCheck size={13} /> Admin
                  </span>
                )}
              </div>
            </div>

            {user.bio && <p className="mt-4 whitespace-pre-wrap text-body leading-relaxed text-text-secondary">{user.bio}</p>}

            {links.length > 0 && (
              <div className="mt-5 flex flex-wrap gap-2">
                {links.map((link) => (
                  <Tooltip key={link.url}>
                    <TooltipTrigger
                      render={
                        <a
                          href={link.url}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`Abrir ${link.label}`}
                          className="flex h-9 w-9 items-center justify-center rounded-md border border-strong bg-bg-tertiary text-text-primary transition-colors hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                        />
                      }
                    >
                      <BrandIcon kind={link.kind} />
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="flex items-center gap-1.5">
                      <span>{link.label}</span>
                      <ExternalLink size={12} />
                    </TooltipContent>
                  </Tooltip>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      )}
      {user && (
        <ImageLightbox
          src={lightboxSrc ?? ''}
          alt={lightboxSrc === user.banner ? 'Banner' : 'Foto de perfil'}
          open={!!lightboxSrc}
          onOpenChange={(open) => { if (!open) setLightboxSrc(null); }}
        />
      )}
    </Dialog>
  );
}

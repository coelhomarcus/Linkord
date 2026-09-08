import { AtSign, BadgeCheck, Camera, Code2, ExternalLink, Link2, MessageCircle, Music2 } from 'lucide-react';
import type { CSSProperties } from 'react';
import { Avatar, colorFor } from '@/shared/Avatar';
import { useRoom } from '@/state/RoomContext';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { PublicUser } from '@/types/protocol';

type LinkKind = 'youtube' | 'twitter' | 'twitch' | 'instagram' | 'github' | 'linkedin' | 'tiktok' | 'spotify' | 'discord' | 'generic';

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
  return { url: rawUrl, kind: 'generic', label: host || 'Link' };
}

function brandColor(kind: LinkKind): string {
  switch (kind) {
    case 'youtube': return '#ff0033';
    case 'twitter': return '#f8fafc';
    case 'twitch': return '#a970ff';
    case 'instagram': return '#e879f9';
    case 'github': return '#e5e7eb';
    case 'linkedin': return '#60a5fa';
    case 'tiktok': return '#22d3ee';
    case 'spotify': return '#22c55e';
    case 'discord': return 'var(--color-blurple)';
    default: return 'var(--color-text-secondary)';
  }
}

function BrandIcon({ kind }: { kind: LinkKind }) {
  switch (kind) {
    case 'youtube':
      return (
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none">
          <rect x="3" y="6" width="18" height="12" rx="3" fill="currentColor" />
          <path d="M10 9.5v5l5-2.5-5-2.5Z" fill="var(--color-bg-primary)" />
        </svg>
      );
    case 'twitter':
      return (
        <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none">
          <path d="M5 4h4.2l3.4 4.8L16.8 4H20l-5.8 6.7L20 20h-4.2l-3.7-5.3L7.5 20H4.3l6.2-7.1L5 4Zm2.2 1.8L16.8 18.2h1L8.2 5.8h-1Z" fill="currentColor" />
        </svg>
      );
    case 'twitch':
      return (
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none">
          <path d="M5 4h15v10l-4 4h-4l-3 3v-3H5V4Z" fill="currentColor" />
          <path d="M8 6v9h4v2l2-2h3l1.5-1.5V6H8Z" fill="var(--color-bg-primary)" />
          <path d="M12 8h1.6v4H12V8Zm4 0h1.6v4H16V8Z" fill="currentColor" />
        </svg>
      );
    case 'instagram':
      return <Camera aria-hidden="true" size={18} />;
    case 'github':
      return <Code2 aria-hidden="true" size={18} />;
    case 'linkedin':
      return (
        <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none">
          <path d="M5 9h3v10H5V9Zm.1-3.1A1.7 1.7 0 1 1 8.5 6a1.7 1.7 0 0 1-3.4-.1ZM10 9h2.9v1.4h.1c.4-.8 1.5-1.7 3-1.7 3.2 0 3.8 2.1 3.8 4.8V19h-3v-4.9c0-1.2 0-2.7-1.6-2.7s-1.9 1.3-1.9 2.6v5h-3V9Z" fill="currentColor" />
        </svg>
      );
    case 'tiktok':
      return <Music2 aria-hidden="true" size={18} />;
    case 'spotify':
      return <Music2 aria-hidden="true" size={18} />;
    case 'discord':
      return <MessageCircle aria-hidden="true" size={18} />;
    default:
      return <Link2 aria-hidden="true" size={18} />;
  }
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

  return (
    <Dialog open={!!user} onOpenChange={(next) => { if (!next) onClose(); }}>
      {user && (
        <DialogContent className="max-w-[calc(100%-2rem)] overflow-hidden bg-bg-modal p-0 sm:max-w-105">
          <DialogTitle className="sr-only">Perfil de {user.displayName}</DialogTitle>
          <div className="h-32 w-full" style={bannerStyle(user)} />
          <div className="px-5 pb-5">
            <div className="-mt-10 flex items-end gap-3">
              <div className="relative rounded-full bg-bg-modal p-1">
                <Avatar id={user.id} name={user.displayName} avatar={user.avatar} avatarColor={user.avatarColor} size={76} />
                {onlineUserIds.has(user.id) && (
                  <span className="absolute right-1 bottom-1 h-4 w-4 rounded-full border-2 border-bg-modal bg-green" />
                )}
              </div>
              <div className="mb-2 flex min-w-0 flex-1 items-center gap-2">
                {user.role === 'admin' && (
                  <span className="flex flex-none items-center gap-1 rounded-sm bg-blurple/15 px-1.5 py-0.5 text-caption font-medium text-blurple">
                    <BadgeCheck size={13} /> Admin
                  </span>
                )}
              </div>
            </div>

            <div className="mt-3 flex min-w-0 flex-col gap-1">
              <h2 className="truncate text-display font-bold text-text-primary">{user.displayName}</h2>
              <p className="flex items-center gap-1 truncate text-label text-text-muted">
                <AtSign size={14} className="flex-none" />
                <span className="truncate">{user.username}</span>
              </p>
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
                          className="flex h-9 w-9 items-center justify-center rounded-md border border-strong bg-bg-tertiary transition-colors hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                          style={{ color: brandColor(link.kind) }}
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
    </Dialog>
  );
}

import { AtSign, BadgeCheck, ExternalLink } from 'lucide-react';
import { Avatar } from '@/shared/Avatar';
import { BrandIcon, bannerStyle, linkInfo } from '@/shared/profileLinks';
import type { LinkInfo } from '@/shared/profileLinks';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/shared/lib/utils';

export interface ProfileCardData {
  id: string;
  displayName: string;
  username: string;
  avatar: string;
  avatarColor: string;
  banner: string;
  bio: string;
  profileLinks: string[];
  role: 'user' | 'admin';
}

interface ProfileCardProps {
  user: ProfileCardData;
  online?: boolean;
  /** Present only in interactive contexts (ProfileModal) — opens a
   * lightbox. Omitted in a static preview (SettingsModal), where the
   * banner/avatar just render, unclickable. */
  onAvatarClick?: () => void;
  onBannerClick?: () => void;
  className?: string;
}

/** The visual profile card — banner, overlapping avatar, name/@handle/role,
 * bio and link icons. Shared by ProfileModal (a real person, clickable
 * media) and SettingsModal's "Perfil" tab (a live preview of your own
 * in-progress edits, static). */
export function ProfileCard({ user, online, onAvatarClick, onBannerClick, className }: ProfileCardProps) {
  const links = (user.profileLinks ?? []).map(linkInfo).filter((item): item is LinkInfo => !!item);

  return (
    <div className={cn('overflow-hidden rounded-xl border border-strong bg-bg-modal', className)}>
      {onBannerClick ? (
        <button
          type="button"
          aria-label="Ver banner em tela cheia"
          onClick={onBannerClick}
          className="block h-40 w-full cursor-zoom-in"
          style={bannerStyle(user)}
        />
      ) : (
        <div className="h-40 w-full" style={bannerStyle(user)} />
      )}
      <div className="px-6 pb-6">
        <div className="-mt-12 flex items-end gap-3">
          <div className="relative rounded-full bg-bg-modal p-1">
            {user.avatar && onAvatarClick ? (
              <button
                type="button"
                aria-label="Ver foto de perfil em tela cheia"
                onClick={onAvatarClick}
                className="block cursor-zoom-in rounded-full focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <Avatar id={user.id} name={user.displayName} avatar={user.avatar} avatarColor={user.avatarColor} size={92} />
              </button>
            ) : (
              <Avatar id={user.id} name={user.displayName} avatar={user.avatar} avatarColor={user.avatarColor} size={92} />
            )}
            {online && <span className="absolute right-1 bottom-1 h-5 w-5 rounded-full border-2 border-bg-modal bg-green" />}
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
    </div>
  );
}

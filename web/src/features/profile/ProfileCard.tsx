import { AtSign, BadgeCheck, Camera, ExternalLink, Loader2, Trash2, Upload } from 'lucide-react';
import { Avatar } from '@/shared/Avatar';
import { BrandIcon, bannerStyle, linkInfo } from '@/shared/profileLinks';
import type { LinkInfo } from '@/shared/profileLinks';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
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
  onAvatarClick?: () => void;
  onBannerClick?: () => void;
  onAvatarUpload?: () => void;
  onAvatarRemove?: () => void;
  avatarUploading?: boolean;
  onBannerUpload?: () => void;
  onBannerRemove?: () => void;
  bannerUploading?: boolean;
  className?: string;
}

export function ProfileCard({
  user, online, onAvatarClick, onBannerClick,
  onAvatarUpload, onAvatarRemove, avatarUploading,
  onBannerUpload, onBannerRemove, bannerUploading,
  className,
}: ProfileCardProps) {
  const links = (user.profileLinks ?? []).map(linkInfo).filter((item): item is LinkInfo => !!item);

  return (
    <div className={cn('overflow-hidden rounded-xl border border-strong bg-bg-modal', className)}>
      {onBannerUpload ? (
        <div className="group relative h-40 w-full" style={bannerStyle(user)}>
          <DropdownMenu>
            <DropdownMenuTrigger
              disabled={bannerUploading}
              render={
                <button
                  type="button"
                  aria-label="Alterar banner"
                  className="absolute inset-0 flex items-center justify-center bg-black/0 text-transparent transition-colors group-hover:bg-black/40 group-hover:text-white focus-visible:bg-black/40 focus-visible:text-white focus-visible:outline-none disabled:cursor-default"
                />
              }
            >
              {bannerUploading ? <Loader2 size={24} className="animate-spin" /> : <Camera size={24} />}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="center">
              <DropdownMenuItem onClick={onBannerUpload}>
                <Upload size={14} />
                <span>Enviar banner</span>
              </DropdownMenuItem>
              {user.banner && onBannerRemove && (
                <DropdownMenuItem variant="destructive" onClick={onBannerRemove}>
                  <Trash2 size={14} />
                  <span>Remover banner</span>
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : onBannerClick ? (
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
            {onAvatarUpload ? (
              <div className="group relative rounded-full">
                <Avatar id={user.id} name={user.displayName} avatar={user.avatar} avatarColor={user.avatarColor} size={92} />
                <DropdownMenu>
                  <DropdownMenuTrigger
                    disabled={avatarUploading}
                    render={
                      <button
                        type="button"
                        aria-label="Alterar foto de perfil"
                        className="absolute inset-0 flex items-center justify-center rounded-full bg-black/0 text-transparent transition-colors group-hover:bg-black/50 group-hover:text-white focus-visible:bg-black/50 focus-visible:text-white focus-visible:outline-none disabled:cursor-default"
                      />
                    }
                  >
                    {avatarUploading ? <Loader2 size={20} className="animate-spin" /> : <Camera size={20} />}
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem onClick={onAvatarUpload}>
                      <Upload size={14} />
                      <span>Enviar foto</span>
                    </DropdownMenuItem>
                    {user.avatar && onAvatarRemove && (
                      <DropdownMenuItem variant="destructive" onClick={onAvatarRemove}>
                        <Trash2 size={14} />
                        <span>Remover foto</span>
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ) : user.avatar && onAvatarClick ? (
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
              <span className="flex flex-none items-center gap-1 rounded-sm bg-primary/15 px-1.5 py-0.5 text-caption font-medium text-primary">
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

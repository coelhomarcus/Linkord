import { useLayoutEffect, useRef } from 'react';
import { AtSign, BadgeCheck, Camera, Check, ExternalLink, Link2, Loader2, Palette, Plus, Trash2, Upload, X } from 'lucide-react';
import { Avatar, AVATAR_COLOR_OPTIONS } from '@/shared/Avatar';
import { BANNER_ASPECT_RATIO, BrandIcon, bannerStyle, linkInfo } from '@/shared/profileLinks';
import type { LinkInfo } from '@/shared/profileLinks';
import { MAX_DISPLAY_NAME_LEN } from '@/shared/lib/displayName';
import { MAX_PROFILE_BIO_LEN, MAX_PROFILE_LINK_LEN, MAX_PROFILE_LINKS } from '@/types/protocol';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
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
  onAvatarUploadUrl?: () => void;
  onAvatarRemove?: () => void;
  avatarUploading?: boolean;
  onBannerUpload?: () => void;
  onBannerUploadUrl?: () => void;
  onBannerRemove?: () => void;
  bannerUploading?: boolean;
  className?: string;
  /** Makes the display name an inline text field instead of a heading —
   * editing happens right where the value is shown, Twitter-style. */
  onDisplayNameChange?: (value: string) => void;
  /** Makes the bio an inline, auto-growing textarea instead of a paragraph. */
  onBioChange?: (value: string) => void;
  onAvatarColorChange?: (value: string) => void;
  /** Makes the links list an editable set of URL fields instead of icon
   * pills — pass the raw (possibly invalid/in-progress) strings here. */
  editableLinks?: string[];
  onLinkChange?: (index: number, value: string) => void;
  onAddLink?: () => void;
  onRemoveLink?: (index: number) => void;
}

function EditableBio({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <div className="mt-4 flex flex-col items-end gap-1">
      <textarea
        ref={ref}
        aria-label="Bio"
        value={value}
        onChange={(e) => onChange(e.target.value.slice(0, MAX_PROFILE_BIO_LEN))}
        placeholder="Fale um pouco sobre você..."
        rows={1}
        className="w-full resize-none overflow-hidden whitespace-pre-wrap bg-transparent text-body leading-relaxed text-text-secondary outline-none placeholder:text-text-muted/70"
      />
      <span className="select-none text-caption tabular-nums text-text-muted">{value.length}/{MAX_PROFILE_BIO_LEN}</span>
    </div>
  );
}

export function ProfileCard({
  user, online, onAvatarClick, onBannerClick,
  onAvatarUpload, onAvatarUploadUrl, onAvatarRemove, avatarUploading,
  onBannerUpload, onBannerUploadUrl, onBannerRemove, bannerUploading,
  className,
  onDisplayNameChange, onBioChange, onAvatarColorChange,
  editableLinks, onLinkChange, onAddLink, onRemoveLink,
}: ProfileCardProps) {
  const links = (user.profileLinks ?? []).map(linkInfo).filter((item): item is LinkInfo => !!item);
  const linksEditable = editableLinks !== undefined && onLinkChange && onAddLink && onRemoveLink;
  const isCustomAvatarColor = !AVATAR_COLOR_OPTIONS.some((option) => option.value === user.avatarColor);

  return (
    <div className={cn('overflow-hidden rounded-xl border border-strong bg-bg-modal', className)}>
      {onBannerUpload ? (
        <div className="group relative w-full" style={{ ...bannerStyle(user), aspectRatio: BANNER_ASPECT_RATIO }}>
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
            <DropdownMenuContent align="center" className="w-max min-w-0">
              <DropdownMenuItem onClick={onBannerUpload}>
                <Upload size={14} />
                <span>Enviar do computador</span>
              </DropdownMenuItem>
              {onBannerUploadUrl && (
                <DropdownMenuItem onClick={onBannerUploadUrl}>
                  <Link2 size={14} />
                  <span>Usar URL</span>
                </DropdownMenuItem>
              )}
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
          className="block w-full cursor-zoom-in"
          style={{ ...bannerStyle(user), aspectRatio: BANNER_ASPECT_RATIO }}
        />
      ) : (
        <div className="w-full" style={{ ...bannerStyle(user), aspectRatio: BANNER_ASPECT_RATIO }} />
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
                  <DropdownMenuContent align="start" className="w-max min-w-0">
                    <DropdownMenuItem onClick={onAvatarUpload}>
                      <Upload size={14} />
                      <span>Enviar do computador</span>
                    </DropdownMenuItem>
                    {onAvatarUploadUrl && (
                      <DropdownMenuItem onClick={onAvatarUploadUrl}>
                        <Link2 size={14} />
                        <span>Usar URL</span>
                      </DropdownMenuItem>
                    )}
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

          {onAvatarColorChange && (
            <div className="mb-1 flex flex-wrap items-center gap-1.5">
              {AVATAR_COLOR_OPTIONS.map((option) => {
                const selected = user.avatarColor === option.value;
                return (
                  <Tooltip key={option.value}>
                    <TooltipTrigger
                      render={
                        <button
                          type="button"
                          aria-label={`Usar ${option.label}`}
                          aria-pressed={selected}
                          onClick={() => onAvatarColorChange(option.value)}
                          className={cn(
                            'relative h-5 w-5 rounded-full border transition focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                            selected ? 'border-text-primary ring-2 ring-ring/40 ring-offset-1 ring-offset-bg-modal' : 'border-strong hover:border-text-muted'
                          )}
                          style={{ background: option.css }}
                        />
                      }
                    >
                      {selected && <Check size={11} className="pointer-events-none absolute inset-0 m-auto text-white drop-shadow" />}
                    </TooltipTrigger>
                    <TooltipContent side="top">{option.label}</TooltipContent>
                  </Tooltip>
                );
              })}
              <label
                title="Cor personalizada"
                className={cn(
                  'relative flex h-5 w-5 items-center justify-center rounded-full border transition focus-within:outline-none focus-within:ring-3 focus-within:ring-ring/40',
                  isCustomAvatarColor ? 'border-text-primary ring-2 ring-ring/40 ring-offset-1 ring-offset-bg-modal' : 'border-strong hover:border-text-muted'
                )}
              >
                <input
                  type="color"
                  aria-label="Escolher cor personalizada"
                  aria-pressed={isCustomAvatarColor}
                  value={isCustomAvatarColor ? user.avatarColor : '#6b7280'}
                  onChange={(e) => onAvatarColorChange(e.target.value)}
                  className="avatar-color-custom-input h-5 w-5 cursor-pointer"
                />
                <span className="pointer-events-none absolute inset-0 m-auto flex h-2.5 w-2.5 items-center justify-center">
                  {isCustomAvatarColor ? <Check size={10} className="text-white drop-shadow" /> : <Palette size={9} className="text-white/90 drop-shadow" />}
                </span>
              </label>
            </div>
          )}
        </div>

        <div className="mt-3 flex min-w-0 flex-col gap-1">
          {onDisplayNameChange ? (
            <input
              aria-label="Nome de exibição"
              maxLength={MAX_DISPLAY_NAME_LEN}
              placeholder={user.username}
              value={user.displayName === user.username ? '' : user.displayName}
              onChange={(e) => onDisplayNameChange(e.target.value)}
              className="w-full min-w-0 bg-transparent text-display font-bold text-text-primary outline-none placeholder:text-text-muted/70"
            />
          ) : (
            <h2 className="truncate text-display font-bold text-text-primary">{user.displayName}</h2>
          )}
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

        {onBioChange ? (
          <EditableBio value={user.bio} onChange={onBioChange} />
        ) : (
          user.bio && <p className="mt-4 whitespace-pre-wrap text-body leading-relaxed text-text-secondary">{user.bio}</p>
        )}

        {linksEditable ? (
          <div className="mt-5 flex flex-col gap-2">
            {editableLinks!.map((link, index) => {
              const info = linkInfo(link);
              return (
                <div key={index} className="flex items-center gap-2">
                  <span className="flex size-8 flex-none items-center justify-center rounded-full border border-strong bg-bg-tertiary text-text-muted">
                    {info ? <BrandIcon kind={info.kind} /> : <Link2 size={15} />}
                  </span>
                  <input
                    aria-label={`Link ${index + 1}`}
                    maxLength={MAX_PROFILE_LINK_LEN}
                    placeholder="https://..."
                    value={link}
                    onChange={(e) => onLinkChange!(index, e.target.value)}
                    className="min-w-0 flex-1 border-b border-transparent bg-transparent py-1 text-body text-text-primary outline-none placeholder:text-text-muted/70 focus:border-primary/50"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Remover link"
                    className="flex-none text-text-muted hover:bg-red/12 hover:text-red"
                    onClick={() => onRemoveLink!(index)}
                  >
                    <X size={15} />
                  </Button>
                </div>
              );
            })}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-fit text-text-muted hover:text-text-primary"
              disabled={editableLinks!.length >= MAX_PROFILE_LINKS}
              onClick={onAddLink}
            >
              <Plus size={14} />
              <span>Adicionar link</span>
            </Button>
          </div>
        ) : (
          links.length > 0 && (
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
          )
        )}
      </div>
    </div>
  );
}

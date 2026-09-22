import type { ReactNode } from 'react';
import { Avatar } from '@/shared/Avatar';
import type { SocialUser } from '@/shared/api/api';

export function SocialUserRow({ user, online, subtitle, onOpenProfile, children }: {
  user: SocialUser;
  /** undefined hides the presence dot (e.g. blocked users — presence isn't shown for them) */
  online?: boolean;
  subtitle?: string;
  onOpenProfile: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg px-3 py-3 transition-colors hover:bg-white/[0.04]">
      <button
        type="button"
        onClick={onOpenProfile}
        aria-label={`Ver perfil de ${user.displayName}`}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="relative flex-none">
          <Avatar id={user.id} name={user.displayName} avatar={user.avatar} avatarColor={user.avatarColor} size={40} />
          {online !== undefined && (
            <span
              aria-hidden
              className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-bg-primary ${online ? 'bg-green' : 'bg-text-muted'}`}
            />
          )}
        </div>
        <div className="min-w-0">
          <p className="truncate text-body font-medium text-text-primary">{user.displayName}</p>
          <p className="truncate text-caption text-text-muted">
            @{user.username}
            {online !== undefined && <span className="sr-only">{online ? ', online' : ', offline'}</span>}
            {subtitle ? ` · ${subtitle}` : ''}
          </p>
        </div>
      </button>
      {children && <div className="flex flex-none items-center gap-1.5">{children}</div>}
    </div>
  );
}

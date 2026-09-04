import { ShieldCheck, X } from 'lucide-react';
import { useRoom } from '../../state/RoomContext';
import { Avatar } from '../../shared/Avatar';
import { sectionLabelClass } from '../../shared/SectionLabel';
import { Button } from '@/components/ui/button';
import { cn } from '@/shared/lib/utils';
import type { PublicUser } from '../../types/protocol';

function UserRow({ user, online }: { user: PublicUser; online: boolean }) {
  return (
    <div className="flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-bg-hover">
      <div className="relative flex-none">
        <Avatar id={user.id} name={user.username} avatar={user.avatar} size={44} />
        {/* status dot — solid gray for offline, not bg-text-muted/40: the
            opacity read as almost transparent on a dark background instead
            of an actual gray dot. */}
        <span
          className={`absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-bg-secondary ${online ? 'bg-green' : 'bg-text-muted'}`}
        />
      </div>
      <span className={`min-w-0 flex-1 truncate text-body ${online ? 'text-text-secondary' : 'text-text-muted'}`}>{user.username}</span>
      {user.role === 'admin' && <ShieldCheck size={16} className="flex-none text-blurple" />}
    </div>
  );
}

interface UserDirectoryProps {
  /** Below md there's no room for a 3rd column — this renders as a
   * fullscreen overlay instead, toggled from ChatPage's header. Ignored
   * from md up, where it's always visible in its normal column. */
  mobileOpen: boolean;
  onMobileClose: () => void;
}

/** Directory of ALL registered accounts, grouped online/offline — like
 * Discord's member list. Only shows on the Chat page, not the call view. */
export function UserDirectory({ mobileOpen, onMobileClose }: UserDirectoryProps) {
  const { allUsers, onlineUserIds } = useRoom();

  const users = [...allUsers.values()].sort((a, b) => a.username.localeCompare(b.username));
  const online = users.filter((u) => onlineUserIds.has(u.id));
  const offline = users.filter((u) => !onlineUserIds.has(u.id));

  return (
    <aside className={cn(
      'fixed inset-0 z-40 w-full flex-col overflow-y-auto border-l border-subtle bg-bg-secondary p-2 md:static md:z-auto md:flex md:w-60 md:flex-none',
      mobileOpen ? 'flex' : 'hidden'
    )}>
      <div className="flex flex-none items-center justify-between px-2 pb-2 md:hidden">
        <span className={sectionLabelClass}>Membros</span>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Fechar" onClick={onMobileClose} className="text-text-muted hover:text-text-secondary">
          <X size={16} />
        </Button>
      </div>
      {online.length > 0 && (
        <div className="flex flex-col gap-0.5">
          <p className={`${sectionLabelClass} px-2 pb-1 pt-2 first:pt-1`}>Online ({online.length})</p>
          {online.map((u) => <UserRow key={u.id} user={u} online />)}
        </div>
      )}
      {offline.length > 0 && (
        <div className="flex flex-col gap-0.5">
          <p className={`${sectionLabelClass} px-2 pb-1 pt-2`}>Offline ({offline.length})</p>
          {offline.map((u) => <UserRow key={u.id} user={u} online={false} />)}
        </div>
      )}
    </aside>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { useRoom } from '@/state/RoomContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/ui/primitives/dialog';
import { Button } from '@/shared/ui/primitives/button';
import { ImageLightbox } from '@/features/media/ImageLightbox';
import { BANNER_ASPECT_RATIO } from '@/features/profile/profileLinks';
import { fetchUserProfile } from '@/shared/api/api';
import type { PublicUser } from '@/shared/types/protocol';
import { ProfileActions } from '@/features/friends/ProfileActions';
import { ProfileCard } from './ProfileCard';
import { ReportDialog } from '@/features/reports/ReportDialog';
import { Flag } from 'lucide-react';

interface ProfileModalProps {
  userId: string | null;
  onClose: () => void;
}

type ProfileImageSelection = {
  src: string;
  kind: 'avatar' | 'banner';
};

/** A profile not already in the known-users cache (Etapa 7 — see
 * usePresence.ts) needs an on-demand fetch: e.g. the author of an old
 * message who has since left the conversation. `fetchStatus` only tracks
 * that fallback path — a cache hit never touches it. */
export function ProfileModal({ userId, onClose }: ProfileModalProps) {
  const { state, allUsers, onlineUserIds } = useRoom();
  const [reportOpen, setReportOpen] = useState(false);
  const cachedUser = userId ? allUsers.get(userId) : null;
  const [fetchedUser, setFetchedUser] = useState<PublicUser | null>(null);
  const [fetchStatus, setFetchStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [lightboxImage, setLightboxImage] = useState<ProfileImageSelection | null>(null);

  const loadProfile = useCallback((id: string) => {
    setFetchStatus('loading');
    fetchUserProfile(id)
      .then(({ user: fetched }) => { setFetchedUser(fetched); setFetchStatus('idle'); })
      .catch(() => setFetchStatus('error'));
  }, []);

  useEffect(() => {
    setFetchedUser(null);
    setFetchStatus('idle');
    if (userId && !allUsers.get(userId)) loadProfile(userId);
    // allUsers deliberately excluded — only userId changing (opening a
    // different profile) should restart the fetch, not every cache update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, loadProfile]);

  const user = cachedUser ?? fetchedUser;
  const open = !!userId && (!!user || fetchStatus !== 'idle');

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      {!user && fetchStatus === 'loading' && (
        <DialogContent className="max-w-[calc(100%-2rem)] bg-bg-modal sm:max-w-130">
          <DialogHeader className="sr-only">
            <DialogTitle>Carregando perfil</DialogTitle>
          </DialogHeader>
          <p className="py-8 text-center text-body text-text-muted">Carregando perfil…</p>
        </DialogContent>
      )}
      {!user && fetchStatus === 'error' && (
        <DialogContent className="max-w-[calc(100%-2rem)] bg-bg-modal sm:max-w-130">
          <DialogHeader className="sr-only">
            <DialogTitle>Não foi possível carregar o perfil</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <p className="text-body text-text-muted">Não foi possível carregar esse perfil.</p>
            <Button type="button" variant="secondary" size="sm" onClick={() => userId && loadProfile(userId)}>
              Tentar de novo
            </Button>
          </div>
        </DialogContent>
      )}
      {user && (
        <DialogContent closeButtonVariant="overlay" className="max-h-[90vh] max-w-[calc(100%-2rem)] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden bg-bg-modal p-0 sm:max-w-130">
          <DialogHeader className="sr-only">
            <DialogTitle>Perfil de {user.displayName}</DialogTitle>
          </DialogHeader>
          <div className="min-h-0 overflow-y-auto">
            <ProfileCard
              bare
              user={user}
              online={onlineUserIds.has(user.id)}
              onBannerClick={user.banner ? () => setLightboxImage({ src: user.banner, kind: 'banner' }) : undefined}
              onAvatarClick={user.avatar ? () => setLightboxImage({ src: user.avatar, kind: 'avatar' }) : undefined}
            />
            <div className="flex items-start justify-between gap-3 border-t border-white/10 px-6 py-4">
              <div className="min-w-0 flex-1">
                <ProfileActions userId={user.id} username={user.username} displayName={user.displayName} onNavigate={onClose} className="p-0" />
              </div>
              {user.id !== state.me.userId && (
                <Button type="button" variant="ghost" size="sm" onClick={() => setReportOpen(true)} className="flex-none text-text-muted hover:text-red-text">
                  <Flag size={14} /><span>Denunciar</span>
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      )}
      {user && (
        <ReportDialog target={{ type: 'user', id: user.id, label: `@${user.username}` }} open={reportOpen} onOpenChange={setReportOpen} />
      )}
      {user && (
        <ImageLightbox
          src={lightboxImage?.src ?? ''}
          alt={lightboxImage?.kind === 'banner' ? 'Banner' : 'Foto de perfil'}
          variant="profile"
          aspectRatio={lightboxImage?.kind === 'banner' ? BANNER_ASPECT_RATIO : 1}
          open={!!lightboxImage}
          onOpenChange={(open) => { if (!open) setLightboxImage(null); }}
        />
      )}
    </Dialog>
  );
}

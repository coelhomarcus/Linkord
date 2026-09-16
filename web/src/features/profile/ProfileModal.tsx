import { useState } from 'react';
import { useRoom } from '@/state/RoomContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ImageLightbox } from '@/shared/ImageLightbox';
import { BANNER_ASPECT_RATIO } from '@/shared/profileLinks';
import { ProfileCard } from './ProfileCard';

interface ProfileModalProps {
  userId: string | null;
  onClose: () => void;
}

type ProfileImageSelection = {
  src: string;
  kind: 'avatar' | 'banner';
};

export function ProfileModal({ userId, onClose }: ProfileModalProps) {
  const { allUsers, onlineUserIds } = useRoom();
  const user = userId ? allUsers.get(userId) : null;
  const [lightboxImage, setLightboxImage] = useState<ProfileImageSelection | null>(null);

  return (
    <Dialog open={!!user} onOpenChange={(next) => { if (!next) onClose(); }}>
      {user && (
        <DialogContent className="max-h-[90vh] max-w-[calc(100%-2rem)] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden bg-bg-modal p-0 sm:max-w-130">
          <DialogHeader className="sr-only">
            <DialogTitle>Perfil de {user.displayName}</DialogTitle>
          </DialogHeader>
          <div className="min-h-0 overflow-y-auto">
            <ProfileCard
              user={user}
              online={onlineUserIds.has(user.id)}
              onBannerClick={user.banner ? () => setLightboxImage({ src: user.banner, kind: 'banner' }) : undefined}
              onAvatarClick={user.avatar ? () => setLightboxImage({ src: user.avatar, kind: 'avatar' }) : undefined}
            />
          </div>
        </DialogContent>
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

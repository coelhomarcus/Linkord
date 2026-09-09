import { useState } from 'react';
import { useRoom } from '@/state/RoomContext';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { ImageLightbox } from '@/shared/ImageLightbox';
import { ProfileCard } from './ProfileCard';

interface ProfileModalProps {
  userId: string | null;
  onClose: () => void;
}

export function ProfileModal({ userId, onClose }: ProfileModalProps) {
  const { allUsers, onlineUserIds } = useRoom();
  const user = userId ? allUsers.get(userId) : null;
  // shared by both avatar and banner — only one can be open at a time
  // anyway (it's a modal), and comparing against user.banner below tells
  // ImageLightbox which alt text to use.
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  return (
    <Dialog open={!!user} onOpenChange={(next) => { if (!next) onClose(); }}>
      {user && (
        <DialogContent className="max-w-[calc(100%-2rem)] overflow-hidden bg-bg-modal p-0 sm:max-w-130">
          <DialogTitle className="sr-only">Perfil de {user.displayName}</DialogTitle>
          <ProfileCard
            user={user}
            online={onlineUserIds.has(user.id)}
            onBannerClick={user.banner ? () => setLightboxSrc(user.banner) : undefined}
            onAvatarClick={user.avatar ? () => setLightboxSrc(user.avatar) : undefined}
          />
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

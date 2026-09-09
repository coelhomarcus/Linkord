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
        // outer stays a fixed-size, non-scrolling box (so the close button
        // this renders stays pinned top-right) — the card itself lives in
        // the inner overflow-y-auto div, same split SettingsModal uses, so
        // a short viewport doesn't cut the card off with no way to scroll
        // to the rest of it.
        <DialogContent className="flex max-h-[90vh] max-w-[calc(100%-2rem)] flex-col overflow-hidden bg-bg-modal p-0 sm:max-w-130">
          <div className="min-h-0 flex-1 overflow-y-auto">
            <DialogTitle className="sr-only">Perfil de {user.displayName}</DialogTitle>
            <ProfileCard
              user={user}
              online={onlineUserIds.has(user.id)}
              onBannerClick={user.banner ? () => setLightboxSrc(user.banner) : undefined}
              onAvatarClick={user.avatar ? () => setLightboxSrc(user.avatar) : undefined}
            />
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

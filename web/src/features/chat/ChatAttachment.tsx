import { useState } from 'react';
import { File as FileIcon } from 'lucide-react';
import type { ChatAttachment as ChatAttachmentData } from '../../types/protocol';
import { ImageLightbox } from '../../shared/ImageLightbox';
import { AudioPlayer, VideoPlayer } from '../../shared/MediaPlayers';
import { formatFileSize } from '../../shared/lib/formatBytes';

const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const VIDEO_MIME_TYPES = new Set(['video/mp4', 'video/webm', 'video/ogg']);
const AUDIO_MIME_TYPES = new Set(['audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/mp4']);

export function ChatAttachment({ attachment }: { attachment: ChatAttachmentData }) {
  const url = `/uploads/${attachment.id}`;
  const [lightboxOpen, setLightboxOpen] = useState(false);

  if (IMAGE_MIME_TYPES.has(attachment.mime)) {
    return (
      <>
        <button type="button" onClick={() => setLightboxOpen(true)} className="mt-1.5 block w-fit cursor-zoom-in">
          <img
            src={url}
            alt={attachment.name}
            loading="lazy"
            className="max-h-80 max-w-[min(24rem,100%)] rounded-md border border-strong object-contain"
          />
        </button>
        <ImageLightbox src={url} alt={attachment.name} open={lightboxOpen} onOpenChange={setLightboxOpen} />
      </>
    );
  }

  if (VIDEO_MIME_TYPES.has(attachment.mime)) {
    return <VideoPlayer src={url} title={attachment.name} className="mt-1.5" />;
  }

  if (AUDIO_MIME_TYPES.has(attachment.mime)) {
    return <AudioPlayer src={url} title={attachment.name} className="mt-1.5" />;
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      download={attachment.name}
      className="mt-1.5 flex w-fit max-w-sm items-center gap-2 rounded-md border border-strong bg-bg-tertiary px-3 py-2 text-label transition-colors hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <FileIcon size={16} className="flex-none text-text-muted" />
      <span className="min-w-0 flex-1 truncate font-medium text-text-secondary">{attachment.name}</span>
      <span className="flex-none text-text-muted">{formatFileSize(attachment.size)}</span>
    </a>
  );
}

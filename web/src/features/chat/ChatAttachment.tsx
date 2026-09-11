import { useState } from 'react';
import { File as FileIcon } from 'lucide-react';
import type { ChatAttachment as ChatAttachmentData } from '../../types/protocol';
import { ImageLightbox } from '../../shared/ImageLightbox';
import { AudioPlayer, VideoPlayer } from '../../shared/MediaPlayers';
import { formatFileSize } from '../../shared/lib/formatBytes';
import { cn } from '../../shared/lib/utils';

const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const VIDEO_MIME_TYPES = new Set(['video/mp4', 'video/webm', 'video/ogg']);
const AUDIO_MIME_TYPES = new Set(['audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/mp4']);

/** Whether this attachment can render flush with the bubble's own edges
 * (see `edgeToEdge` on ChatAttachment) instead of sitting in its own
 * bordered card — image/video/audio all have chrome substantial enough to
 * read as the bubble itself rather than a floating box nested inside it. */
export function isEdgeToEdgeMime(mime: string): boolean {
  return IMAGE_MIME_TYPES.has(mime) || VIDEO_MIME_TYPES.has(mime) || AUDIO_MIME_TYPES.has(mime);
}

interface ChatAttachmentProps {
  attachment: ChatAttachmentData;
  /** True when this is the message's only content (no caption, no reply) —
   * drops the outer border/rounding/padding so the player fills the bubble
   * instead of sitting in a second frame nested inside it. */
  edgeToEdge?: boolean;
}

export function ChatAttachment({ attachment, edgeToEdge }: ChatAttachmentProps) {
  const url = `/uploads/${attachment.id}`;
  const [lightboxOpen, setLightboxOpen] = useState(false);

  if (IMAGE_MIME_TYPES.has(attachment.mime)) {
    return (
      <>
        <button type="button" onClick={() => setLightboxOpen(true)} className={cn('block w-fit cursor-zoom-in', !edgeToEdge && 'mt-1.5')}>
          <img
            src={url}
            alt={attachment.name}
            loading="lazy"
            className={cn('max-h-80 max-w-[min(24rem,100%)] object-contain', edgeToEdge ? 'rounded-2xl' : 'rounded-md border border-white/10')}
          />
        </button>
        <ImageLightbox src={url} alt={attachment.name} open={lightboxOpen} onOpenChange={setLightboxOpen} />
      </>
    );
  }

  if (VIDEO_MIME_TYPES.has(attachment.mime)) {
    return (
      <VideoPlayer
        src={url}
        title={attachment.name}
        className={edgeToEdge ? 'rounded-2xl border-0' : 'mt-1.5'}
      />
    );
  }

  if (AUDIO_MIME_TYPES.has(attachment.mime)) {
    return (
      <AudioPlayer
        src={url}
        title={attachment.name}
        className={edgeToEdge ? 'w-80 max-w-full rounded-2xl border-0 bg-transparent shadow-none' : 'mt-1.5'}
      />
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      download={attachment.name}
      className="mt-1.5 flex w-fit max-w-sm items-center gap-2 rounded-md border border-white/10 bg-bg-tertiary px-3 py-2 text-label transition-colors hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <FileIcon size={16} className="flex-none text-text-muted" />
      <span className="min-w-0 flex-1 truncate font-medium text-text-secondary">{attachment.name}</span>
      <span className="flex-none text-text-muted">{formatFileSize(attachment.size)}</span>
    </a>
  );
}

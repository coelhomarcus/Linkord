import { useState } from 'react';
import type { ChatAttachment as ChatAttachmentData } from '@/shared/types/protocol';
import { FileAttachmentCard, FILE_CARD_MAX_WIDTH } from '@/features/media/FileAttachmentCard';
import { ImageLightbox } from '@/features/media/ImageLightbox';
import { AudioPlayer, VideoPlayer } from '@/features/media/MediaPlayers';
import { TextPreviewCard } from '@/features/media/TextPreviewCard';
import { useCachedImageSrc } from '@/shared/hooks/useCachedImageSrc';
import { availableAttachmentWidth, useChatSurfaceWidth } from '../../shared/lib/chatSurfaceWidth';
import { cn } from '../../shared/lib/utils';

export const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
export const VIDEO_MIME_TYPES = new Set(['video/mp4', 'video/webm', 'video/ogg']);
export const AUDIO_MIME_TYPES = new Set(['audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/mp4']);
// Mirrors server/src/modules/attachments.ts#TEXT_PREVIEW_EXTENSIONS and
// features/media/filePresentation.ts#TEXT_CODE_EXTENSIONS — no shared
// package between those, so this is duplicated on purpose, same as the mime
// sets above vs INLINE_MIME_TYPES.
const TEXT_PREVIEW_EXTENSIONS = new Set([
  'md', 'markdown', 'txt', 'json', 'jsonc', 'yaml', 'yml', 'csv', 'tsv', 'xml', 'log', 'env',
  'js', 'jsx', 'ts', 'tsx', 'py', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'hpp', 'cs', 'rb', 'php',
  'sh', 'bash', 'sql', 'css', 'scss', 'html', 'vue', 'toml', 'ini', 'diff', 'patch',
]);

function isTextPreviewable(attachment: ChatAttachmentData): boolean {
  const match = /\.([^./\\]+)$/.exec(attachment.name);
  const ext = match ? match[1]!.toLowerCase() : '';
  return TEXT_PREVIEW_EXTENSIONS.has(ext) || attachment.mime.startsWith('text/');
}

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
  // Thumbnail (when one was generated) for the inline preview — the
  // lightbox below always opens the full original, same as the download.
  const thumbUrl = attachment.thumbId ? `/uploads/${attachment.thumbId}` : url;
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const surfaceWidth = useChatSurfaceWidth(FILE_CARD_MAX_WIDTH + 120);
  const maxWidth = availableAttachmentWidth(surfaceWidth, FILE_CARD_MAX_WIDTH);
  // Left unset (not thumbUrl) while the cache warms — see useCachedImageSrc,
  // a fallback src here would fire a second, concurrent request for the
  // same image.
  // Hooks can't sit behind the MIME branch below, so the url is nulled
  // instead — otherwise a 2 GiB video or zip would be downloaded whole into
  // a blob just to never be shown as an image.
  const isImage = IMAGE_MIME_TYPES.has(attachment.mime);
  const cachedThumbUrl = useCachedImageSrc(isImage ? thumbUrl : null);

  if (isImage) {
    return (
      <>
        <button type="button" onClick={() => setLightboxOpen(true)} className={cn('block max-w-full cursor-zoom-in', !edgeToEdge && 'mt-1.5')}>
          <img
            src={cachedThumbUrl ?? undefined}
            alt={attachment.name}
            loading="lazy"
            style={{ maxWidth }}
            className={cn(
              'block h-auto max-h-80 max-w-full object-contain',
              edgeToEdge ? 'rounded-2xl' : 'rounded-md border border-white/10'
            )}
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
        className={edgeToEdge ? 'rounded-2xl border-0' : undefined}
      />
    );
  }

  if (AUDIO_MIME_TYPES.has(attachment.mime)) {
    return (
      <AudioPlayer
        src={url}
        title={attachment.name}
        className={edgeToEdge ? 'max-w-full rounded-2xl border-0 bg-transparent shadow-none' : undefined}
      />
    );
  }

  if (isTextPreviewable(attachment)) {
    return <TextPreviewCard attachment={attachment} maxWidth={maxWidth} />;
  }

  return <FileAttachmentCard name={attachment.name} size={attachment.size} mime={attachment.mime} url={url} maxWidth={maxWidth} />;
}

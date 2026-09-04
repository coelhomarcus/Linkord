import { useState } from 'react';
import { File as FileIcon } from 'lucide-react';
import type { ChatAttachment as ChatAttachmentData } from '../../types/protocol';
import { ImageLightbox } from '../../shared/ImageLightbox';
import { formatFileSize } from '../../shared/lib/formatBytes';

// mirrors INLINE_MIME_TYPES from server/src/modules/attachments.ts — only
// decides HOW to render here; the server decides how it actually serves it
// back (Content-Type/Content-Disposition), this list is UI-only.
const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const VIDEO_MIME_TYPES = new Set(['video/mp4', 'video/webm', 'video/ogg']);
const AUDIO_MIME_TYPES = new Set(['audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/mp4']);

/** An attachment (image, video, audio, or any other file) inside a message.
 * Images open a fullscreen modal on click (ImageLightbox, Discord-style —
 * no longer a new tab); video/audio play inline; any other type becomes a
 * name+size chip that downloads on click (the server already forces
 * download via Content-Disposition in that case, see
 * server/src/modules/attachments.ts).
 *
 * `target="_blank"` on the download chip is NOT cosmetic: without it, a
 * click navigates OUR OWN tab to the link (even with server-forced
 * download, some browsers still navigate first) — unmounting the whole app
 * and dropping an ongoing call with it. With _blank, the worst case is a
 * new tab, never ours. */
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
            // fixed max-w (not just max-w-full): otherwise a much-wider-than-
            // tall image grows to the chat column's full width to fit
            // max-h — huge even though it's "just" a thumbnail.
            className="max-h-80 max-w-sm rounded-md border border-strong object-contain"
          />
        </button>
        <ImageLightbox src={url} alt={attachment.name} open={lightboxOpen} onOpenChange={setLightboxOpen} />
      </>
    );
  }

  if (VIDEO_MIME_TYPES.has(attachment.mime)) {
    return (
      // eslint-disable-next-line jsx-a11y/media-has-caption
      <video src={url} controls preload="metadata" className="mt-1.5 max-h-80 max-w-sm rounded-md border border-strong bg-black" />
    );
  }

  if (AUDIO_MIME_TYPES.has(attachment.mime)) {
    return <audio src={url} controls preload="metadata" className="mt-1.5 max-w-full" />;
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

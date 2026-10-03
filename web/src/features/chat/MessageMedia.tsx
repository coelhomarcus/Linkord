import type { ChatAttachment as ChatAttachmentData } from '@/shared/types/protocol';
import { useCachedImageSrc } from '@/shared/hooks/useCachedImageSrc';
import { cn } from '@/shared/lib/utils';
import { ChatAttachment } from './ChatAttachment';
import { MEDIA_MAX_WIDTH, mosaicLayout, singleImageBox, splitAttachments } from './mediaLayout';
import { MediaViewerProvider } from './MediaViewerProvider';
import { useMediaViewer } from './useMediaViewer';

function MediaImage({ attachment, className }: { attachment: ChatAttachmentData; className?: string }) {
  // Left unset (not the raw url) while the cache warms — see
  // useCachedImageSrc: a fallback src would fire a second request.
  const src = useCachedImageSrc(`/uploads/${attachment.thumbId ?? attachment.id}`);
  return <img src={src ?? undefined} alt={attachment.name} loading="lazy" className={className} />;
}

/** The pictures of a message as one unit (a lone image at its own shape, or
 * a 2–4 mosaic), followed by its other files. Every box is sized before the
 * pixels arrive, so loading doesn't move the history. */
export function MessageMedia({ attachments }: { attachments: ChatAttachmentData[] }) {
  const viewer = useMediaViewer();
  if (!viewer) return <MediaViewerProvider><MessageMedia attachments={attachments} /></MediaViewerProvider>;

  const { visual, files } = splitAttachments(attachments);
  const openAt = (index: number) => viewer.open(visual.map((a) => ({ src: `/uploads/${a.id}`, name: a.name })), index);
  const cellButton = 'block cursor-zoom-in overflow-hidden bg-white/[0.04] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/60';

  let pictures = null;
  if (visual.length === 1) {
    const attachment = visual[0]!;
    const box = singleImageBox(attachment);
    pictures = box ? (
      <button type="button" aria-label={`Abrir ${attachment.name}`} onClick={() => openAt(0)} style={{ width: box.width, aspectRatio: box.aspectRatio }} className={cn(cellButton, 'rounded-xl')}>
        <MediaImage attachment={attachment} className="block size-full object-cover" />
      </button>
    ) : (
      // stored before dimensions existed: natural size, as it always was
      <button type="button" aria-label={`Abrir ${attachment.name}`} onClick={() => openAt(0)} className={cn(cellButton, 'inline-block max-w-full rounded-xl')} style={{ maxWidth: `min(100%, ${MEDIA_MAX_WIDTH}px)` }}>
        <MediaImage attachment={attachment} className="block h-auto max-h-80 max-w-full object-contain" />
      </button>
    );
  } else if (visual.length > 1) {
    const layout = mosaicLayout(visual.length);
    pictures = (
      <div
        className="grid gap-0.5 overflow-hidden rounded-xl"
        style={{ width: `min(100%, ${MEDIA_MAX_WIDTH}px)`, aspectRatio: layout.aspectRatio, gridTemplateColumns: layout.columns, gridTemplateRows: layout.rows }}
      >
        {visual.map((attachment, index) => (
          <button
            key={attachment.id}
            type="button"
            aria-label={`Abrir ${attachment.name} (${index + 1} de ${visual.length})`}
            onClick={() => openAt(index)}
            style={{ gridArea: layout.areas[index] }}
            className={cn(cellButton, 'min-h-0 min-w-0')}
          >
            <MediaImage attachment={attachment} className="block size-full object-cover" />
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="mt-1.5 flex flex-col gap-1.5">
      {pictures}
      {files.map((attachment) => <ChatAttachment key={attachment.id} attachment={attachment} />)}
    </div>
  );
}

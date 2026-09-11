import { useState } from 'react';
import type { ChatAttachment as ChatAttachmentData } from '../../types/protocol';
import { ImageLightbox } from '../../shared/ImageLightbox';
import { availableAttachmentWidth, useChatSurfaceWidth } from '../../shared/lib/chatSurfaceWidth';

/** WhatsApp-style 2x2 square grid for a message whose attachments are all
 * images and number exactly 4 — see MessageRow, which is the only caller
 * and already checked both conditions before rendering this. */
export function ImageAttachmentGrid({ attachments }: { attachments: ChatAttachmentData[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const surfaceWidth = useChatSurfaceWidth(384 + 120);
  const maxWidth = availableAttachmentWidth(surfaceWidth, 384);
  const opened = openIndex != null ? attachments[openIndex] : undefined;

  return (
    <>
      {/* auto-rows-fr: without it, the 2 implicit rows size to their own
          content (the images' natural aspect ratio) instead of splitting
          the square evenly — h-full on each cell then has nothing definite
          to resolve against, so cells collapse instead of filling a
          uniform 2x2 grid. */}
      <div className="mt-1.5 grid grid-cols-2 auto-rows-fr gap-0.5 overflow-hidden rounded-2xl" style={{ width: maxWidth, aspectRatio: '1 / 1' }}>
        {attachments.map((attachment, index) => (
          <button
            key={attachment.id}
            type="button"
            onClick={() => setOpenIndex(index)}
            className="block h-full w-full cursor-zoom-in overflow-hidden"
          >
            <img
              src={`/uploads/${attachment.id}`}
              alt={attachment.name}
              loading="lazy"
              className="block h-full w-full object-cover"
            />
          </button>
        ))}
      </div>
      <ImageLightbox
        src={opened ? `/uploads/${opened.id}` : ''}
        alt={opened?.name ?? ''}
        open={openIndex != null}
        onOpenChange={(next) => { if (!next) setOpenIndex(null); }}
      />
    </>
  );
}

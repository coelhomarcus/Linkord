import type { ChatAttachment } from '@/shared/types/protocol';
import { IMAGE_MIME_TYPES } from './ChatAttachment';

// Local ceilings for media inside a message: the row itself spans the whole
// panel, pictures don't. All sizes are CSS, resolved against the message
// body's real width — no JS measurement, so the call panel and a phone get
// the same rules as the main panel.
export const MEDIA_MAX_WIDTH = 560;
const SINGLE_MAX_HEIGHT = 420;

/** Pictures form the mosaic; everything else (players, documents) follows
 * as its own rows. Order inside each group is the order the sender chose. */
export function splitAttachments(attachments: ChatAttachment[]): { visual: ChatAttachment[]; files: ChatAttachment[] } {
  const visual: ChatAttachment[] = [];
  const files: ChatAttachment[] = [];
  for (const attachment of attachments) (IMAGE_MIME_TYPES.has(attachment.mime) ? visual : files).push(attachment);
  return { visual, files };
}

export interface SingleBox {
  aspectRatio: string;
  /** CSS width: never wider than the body, the ceiling, the image itself,
   * or what the height cap allows at this ratio */
  width: string;
}

/** Box for a lone image with known size; null keeps the old natural-size
 * rendering for rows stored before dimensions existed. */
export function singleImageBox(attachment: Pick<ChatAttachment, 'width' | 'height'>): SingleBox | null {
  const { width, height } = attachment;
  if (!width || !height) return null;
  const heightCapWidth = Math.round((SINGLE_MAX_HEIGHT * width) / height);
  return {
    aspectRatio: `${width} / ${height}`,
    width: `min(100%, ${Math.min(MEDIA_MAX_WIDTH, width, heightCapWidth)}px)`,
  };
}

export interface MosaicLayout {
  aspectRatio: string;
  columns: string;
  rows: string;
  /** grid-area per cell, in order; the first cell leads when sizes differ */
  areas: string[];
}

/** Fixed templates for 2–4 pictures: cells are cropped (cover), the viewer
 * shows each whole. Order is reading order — never rearranged by what loads
 * first. Counts outside the templates fall back to rows of two. */
export function mosaicLayout(count: number): MosaicLayout {
  switch (count) {
    case 2:
      return { aspectRatio: '2 / 1', columns: '1fr 1fr', rows: '1fr', areas: ['1 / 1', '1 / 2'] };
    case 3:
      return { aspectRatio: '3 / 2', columns: '2fr 1fr', rows: '1fr 1fr', areas: ['1 / 1 / 3 / 2', '1 / 2', '2 / 2'] };
    case 4:
      return { aspectRatio: '4 / 3', columns: '1fr 1fr', rows: '1fr 1fr', areas: ['1 / 1', '1 / 2', '2 / 1', '2 / 2'] };
    default: {
      const rowCount = Math.ceil(count / 2);
      return {
        aspectRatio: `2 / ${rowCount}`,
        columns: '1fr 1fr',
        rows: `repeat(${rowCount}, 1fr)`,
        areas: Array.from({ length: count }, (_, i) => `${Math.floor(i / 2) + 1} / ${(i % 2) + 1}`),
      };
    }
  }
}

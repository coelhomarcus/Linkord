import { describe, expect, it } from 'vitest';
import { mosaicLayout, singleImageBox, splitAttachments } from '@/features/chat/mediaLayout';
import type { ChatAttachment } from '@/shared/types/protocol';

const att = (id: string, mime: string): ChatAttachment => ({ id, name: id, mime, size: 1 });

describe('splitAttachments', () => {
  it("images go to the mosaic, the rest becomes its own rows, preserving each group's order", () => {
    const { visual, files } = splitAttachments([att('a', 'image/png'), att('doc', 'application/pdf'), att('b', 'image/jpeg'), att('v', 'video/mp4')]);
    expect(visual.map((a) => a.id)).toEqual(['a', 'b']);
    expect(files.map((a) => a.id)).toEqual(['doc', 'v']);
  });
});

describe('singleImageBox', () => {
  it('large landscape: capped at the local ceiling and 100% of the body', () => {
    expect(singleImageBox({ width: 4000, height: 3000 })).toEqual({ aspectRatio: '4000 / 3000', width: 'min(100%, 560px)' });
  });

  it('tall portrait: the max height defines the width', () => {
    expect(singleImageBox({ width: 1000, height: 2000 })!.width).toBe('min(100%, 210px)');
  });

  it('small image is not enlarged', () => {
    expect(singleImageBox({ width: 120, height: 80 })!.width).toBe('min(100%, 120px)');
  });

  it('narrow panorama still fits in the body', () => {
    expect(singleImageBox({ width: 6000, height: 1000 })!.width).toBe('min(100%, 560px)');
  });

  it('no dimensions (old attachment): no reserved box', () => {
    expect(singleImageBox({})).toBeNull();
  });
});

describe('mosaicLayout', () => {
  it.each([2, 3, 4, 5, 7])('%i images: one area per image', (count) => {
    expect(mosaicLayout(count).areas).toHaveLength(count);
  });

  it('3 images: the featured first one spans both rows of the left column', () => {
    const layout = mosaicLayout(3);
    expect(layout.columns).toBe('2fr 1fr');
    expect(layout.areas[0]).toBe('1 / 1 / 3 / 2');
  });

  it('4 images: 2x2 grid', () => {
    expect(mosaicLayout(4)).toMatchObject({ columns: '1fr 1fr', rows: '1fr 1fr' });
  });
});

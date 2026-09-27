import { describe, expect, it } from 'vitest';
import { mosaicLayout, singleImageBox, splitAttachments } from '@/features/chat/mediaLayout';
import type { ChatAttachment } from '@/shared/types/protocol';

const att = (id: string, mime: string): ChatAttachment => ({ id, name: id, mime, size: 1 });

describe('splitAttachments', () => {
  it('imagens vao para o mosaico, o resto vira linhas proprias, preservando a ordem de cada grupo', () => {
    const { visual, files } = splitAttachments([att('a', 'image/png'), att('doc', 'application/pdf'), att('b', 'image/jpeg'), att('v', 'video/mp4')]);
    expect(visual.map((a) => a.id)).toEqual(['a', 'b']);
    expect(files.map((a) => a.id)).toEqual(['doc', 'v']);
  });
});

describe('singleImageBox', () => {
  it('paisagem grande: limitada ao teto local e a 100% do corpo', () => {
    expect(singleImageBox({ width: 4000, height: 3000 })).toEqual({ aspectRatio: '4000 / 3000', width: 'min(100%, 560px)' });
  });

  it('retrato alto: a altura maxima define a largura', () => {
    expect(singleImageBox({ width: 1000, height: 2000 })!.width).toBe('min(100%, 210px)');
  });

  it('imagem pequena nao e ampliada', () => {
    expect(singleImageBox({ width: 120, height: 80 })!.width).toBe('min(100%, 120px)');
  });

  it('panorama estreito continua cabendo no corpo', () => {
    expect(singleImageBox({ width: 6000, height: 1000 })!.width).toBe('min(100%, 560px)');
  });

  it('sem dimensoes (anexo antigo): sem caixa reservada', () => {
    expect(singleImageBox({})).toBeNull();
  });
});

describe('mosaicLayout', () => {
  it.each([2, 3, 4, 5, 7])('%i imagens: uma area por imagem', (count) => {
    expect(mosaicLayout(count).areas).toHaveLength(count);
  });

  it('3 imagens: a primeira em destaque ocupa as duas linhas da coluna esquerda', () => {
    const layout = mosaicLayout(3);
    expect(layout.columns).toBe('2fr 1fr');
    expect(layout.areas[0]).toBe('1 / 1 / 3 / 2');
  });

  it('4 imagens: grade 2 x 2', () => {
    expect(mosaicLayout(4)).toMatchObject({ columns: '1fr 1fr', rows: '1fr 1fr' });
  });
});

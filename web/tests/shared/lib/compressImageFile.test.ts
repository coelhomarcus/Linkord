import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compressImageFile } from '@/shared/lib/compressImageFile';

function fakeFile(name: string, type: string, byteLength: number): File {
  return new File([new Uint8Array(byteLength)], name, { type });
}

function mockCanvasEncode(resultBlob: Blob | null) {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb) => cb(resultBlob));
}

describe('compressImageFile', () => {
  let createImageBitmapMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // jsdom doesn't implement OffscreenCanvas — force the regular <canvas> path.
    vi.stubGlobal('OffscreenCanvas', undefined);
    createImageBitmapMock = vi.fn(async () => ({ width: 10, height: 10, close: vi.fn() }));
    vi.stubGlobal('createImageBitmap', createImageBitmapMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('comprime um JPEG pra WebP menor, trocando a extensao', async () => {
    mockCanvasEncode(new Blob([new Uint8Array(500)], { type: 'image/webp' }));
    const original = fakeFile('foto.jpg', 'image/jpeg', 1000);

    const result = await compressImageFile(original);

    expect(result.name).toBe('foto.webp');
    expect(result.type).toBe('image/webp');
    expect(result.size).toBe(500);
    expect(result).not.toBe(original);
  });

  it('troca a extensao preservando maiusculas do nome base (foto.JPG -> foto.webp)', async () => {
    mockCanvasEncode(new Blob([new Uint8Array(10)], { type: 'image/webp' }));
    const result = await compressImageFile(fakeFile('foto.JPG', 'image/jpeg', 1000));
    expect(result.name).toBe('foto.webp');
  });

  it('pula GIF sem tentar decodificar (preserva animacao)', async () => {
    const original = fakeFile('anim.gif', 'image/gif', 1000);
    const result = await compressImageFile(original);

    expect(result).toBe(original);
    expect(createImageBitmapMock).not.toHaveBeenCalled();
  });

  it('quando o navegador recusa WebP e cai pra PNG, devolve o arquivo original', async () => {
    mockCanvasEncode(new Blob([new Uint8Array(500)], { type: 'image/png' }));
    const original = fakeFile('foto.jpg', 'image/jpeg', 1000);

    const result = await compressImageFile(original);
    expect(result).toBe(original);
  });

  it('quando o resultado nao fica menor, devolve o arquivo original', async () => {
    mockCanvasEncode(new Blob([new Uint8Array(2000)], { type: 'image/webp' }));
    const original = fakeFile('foto.jpg', 'image/jpeg', 1000);

    const result = await compressImageFile(original);
    expect(result).toBe(original);
  });

  it('se a decodificacao falhar, devolve o arquivo original sem lancar', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => { throw new Error('imagem corrompida'); }));
    const original = fakeFile('foto.jpg', 'image/jpeg', 1000);

    await expect(compressImageFile(original)).resolves.toBe(original);
  });
});

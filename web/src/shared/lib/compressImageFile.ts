export interface CompressImageOptions {
  quality?: number;
}

const CONVERTIBLE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/bmp']);

function swapExtensionToWebp(name: string): string {
  return name.replace(/\.[^./\\]+$/, '') + '.webp';
}

async function encodeToWebp(bitmap: ImageBitmap, quality: number): Promise<Blob | null> {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0);
    return canvas.convertToBlob({ type: 'image/webp', quality });
  }

  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', quality));
}

// Comprime e converte a imagem pra WebP no navegador, antes do upload. Nunca
// rejeita — a compressao e uma otimizacao opcional, nao pode travar o envio,
// entao qualquer falha (imagem corrompida, navegador sem suporte a WebP via
// canvas) cai de volta pro arquivo original.
export async function compressImageFile(file: File, options?: CompressImageOptions): Promise<File> {
  const quality = options?.quality ?? 0.8;

  if (!CONVERTIBLE_TYPES.has(file.type)) return file;

  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const blob = await encodeToWebp(bitmap, quality);
    // O navegador cai pra PNG silenciosamente quando o tipo pedido nao e
    // suportado — nesse caso, nao sobe um blob com extensao errada.
    if (!blob || blob.type !== 'image/webp') return file;
    // Se o resultado nao ficou menor, comprimir nao trouxe beneficio nenhum.
    if (blob.size >= file.size) return file;
    return new File([blob], swapExtensionToWebp(file.name), { type: 'image/webp', lastModified: file.lastModified });
  } catch (err) {
    console.warn('[compressImageFile] falling back to original file', err);
    return file;
  } finally {
    bitmap?.close();
  }
}

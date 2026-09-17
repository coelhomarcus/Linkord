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

// Compresses and converts the image to WebP in the browser, before upload.
// Never rejects — compression is an optional optimization, it can't block
// the send, so any failure (corrupted image, browser without canvas WebP
// support) falls back to the original file.
export async function compressImageFile(file: File, options?: CompressImageOptions): Promise<File> {
  const quality = options?.quality ?? 0.8;

  if (!CONVERTIBLE_TYPES.has(file.type)) return file;

  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const blob = await encodeToWebp(bitmap, quality);
    // The browser silently falls back to PNG when the requested type isn't
    // supported — in that case, don't upload a blob with the wrong extension.
    if (!blob || blob.type !== 'image/webp') return file;
    // If the result isn't smaller, compressing brought no benefit.
    if (blob.size >= file.size) return file;
    return new File([blob], swapExtensionToWebp(file.name), { type: 'image/webp', lastModified: file.lastModified });
  } catch (err) {
    console.warn('[compressImageFile] falling back to original file', err);
    return file;
  } finally {
    bitmap?.close();
  }
}

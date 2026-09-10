import type { Area } from 'react-easy-crop';

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Nao foi possivel carregar a imagem.'));
    img.src = src;
  });
}

export async function getCroppedImageBlob(imageSrc: string, cropPixels: Area, quality = 0.92): Promise<Blob> {
  const image = await loadImage(imageSrc);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(cropPixels.width);
  canvas.height = Math.round(cropPixels.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas nao suportado.');
  ctx.drawImage(
    image,
    cropPixels.x, cropPixels.y, cropPixels.width, cropPixels.height,
    0, 0, canvas.width, canvas.height
  );
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob); else reject(new Error('Falha ao gerar a imagem recortada.'));
    }, 'image/jpeg', quality);
  });
}

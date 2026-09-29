import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ImageLightbox } from '@/features/media/ImageLightbox';

describe('ImageLightbox', () => {
  it('uses the standardized profile frame and enlarges the image without distorting it', () => {
    render(<ImageLightbox src="/small-avatar.webp" alt="Foto de perfil" variant="profile" aspectRatio={1} open onOpenChange={vi.fn()} />);

    const image = screen.getByRole('img', { name: 'Foto de perfil' });
    const frame = document.querySelector<HTMLElement>('[data-slot="image-lightbox-frame"]');

    expect(frame).not.toBeNull();
    expect(frame).toHaveStyle({ width: '80vw', maxWidth: '80vh' });
    expect(frame?.style.aspectRatio).toBe('1 / 1');
    expect(image).toHaveClass('h-full', 'w-full', 'object-contain');
    expect(image).toHaveAttribute('src', '/small-avatar.webp');
  });

  it('keeps the default preview without the profile frame', () => {
    render(<ImageLightbox src="/attachment.png" alt="Anexo" open onOpenChange={vi.fn()} />);

    expect(document.querySelector('[data-slot="image-lightbox-frame"]')).toBeNull();
    expect(screen.getByRole('img', { name: 'Anexo' })).toHaveClass('max-h-full', 'max-w-full', 'object-contain');
  });

  it('closes via the button, the backdrop, and the popup outside the image', () => {
    const onOpenChange = vi.fn();
    render(<ImageLightbox src="/banner.webp" alt="Banner" variant="profile" open onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Fechar' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);

    fireEvent.click(document.querySelector('[data-slot="image-lightbox-backdrop"]')!);
    expect(onOpenChange).toHaveBeenCalledWith(false);

    fireEvent.click(document.querySelector('[data-slot="image-lightbox-popup"]')!);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('sizes a banner by the 16:9 ratio using the viewport', () => {
    render(<ImageLightbox src="/small-banner.webp" alt="Banner" variant="profile" aspectRatio={16 / 9} open onOpenChange={vi.fn()} />);

    const frame = document.querySelector<HTMLElement>('[data-slot="image-lightbox-frame"]');
    expect(frame).toHaveStyle({ width: '80vw', maxWidth: `${(80 * 16) / 9}vh` });
    expect(frame?.style.aspectRatio).toBe(`${16 / 9} / 1`);
  });
});

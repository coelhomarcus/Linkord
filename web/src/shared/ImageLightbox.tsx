import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { X } from 'lucide-react';

interface ImageLightboxProps {
  src: string;
  alt: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Fullscreen image modal, Discord-style — clicking a chat image opens this
 * instead of navigating to a new tab. Doesn't use the generic Dialog
 * (ui/dialog.tsx) on purpose: that one is a small "card" with
 * background/padding/max-w meant for forms, here the image itself is the
 * content with no frame — needs Base UI's primitives directly to control
 * that. Dark background (not the default Dialog's light gray); clicking
 * outside or Escape closes it (Base UI already handles Escape/focus);
 * clicking the image itself does NOT close it. */
export function ImageLightbox({ src, alt, open, onOpenChange }: ImageLightboxProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/85 duration-150 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
        <DialogPrimitive.Popup
          className="fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center p-8 outline-none duration-150 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0"
          onClick={() => onOpenChange(false)}
        >
          <DialogPrimitive.Title className="sr-only">{alt || 'Imagem'}</DialogPrimitive.Title>
          <img
            src={src}
            alt={alt}
            className="max-h-full max-w-full cursor-default rounded-md object-contain shadow-popover"
            onClick={(e) => e.stopPropagation()}
          />
          <DialogPrimitive.Close
            aria-label="Fechar"
            className="fixed right-4 top-4 z-50 flex size-10 items-center justify-center rounded-full bg-black/50 text-white transition-colors hover:bg-black/70 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <X size={18} />
          </DialogPrimitive.Close>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

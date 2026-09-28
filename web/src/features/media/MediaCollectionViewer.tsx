import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { CloseButton } from '@/shared/ui/primitives/close-button';

export interface ViewerItem {
  /** full-size original, the same thing download gets */
  src: string;
  name: string;
}

interface MediaCollectionViewerProps {
  items: ViewerItem[];
  index: number;
  open: boolean;
  onIndexChange: (index: number) => void;
  onOpenChange: (open: boolean) => void;
}

const navButton = 'grid size-11 place-items-center rounded-full bg-black/55 text-white transition-colors hover:bg-black/75 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/60 disabled:pointer-events-none disabled:opacity-30';

/** Full-size viewer for the pictures of one message, with previous/next.
 * Separate from ImageLightbox, whose single-image contract the profile
 * screens depend on. */
export function MediaCollectionViewer({ items, index, open, onIndexChange, onOpenChange }: MediaCollectionViewerProps) {
  const item = items[index];
  const hasPrev = index > 0;
  const hasNext = index < items.length - 1;

  return (
    <DialogPrimitive.Root open={open && !!item} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/90 duration-150 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 motion-reduce:animate-none" />
        <DialogPrimitive.Popup
          aria-label={item ? `${item.name}, ${index + 1} de ${items.length}` : 'Imagem'}
          className="fixed inset-0 z-50 flex flex-col outline-none duration-150 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 motion-reduce:animate-none"
          onClick={() => onOpenChange(false)}
          // on the popup, which holds focus while open — a window listener
          // loses to handlers elsewhere in the app that stop propagation
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft' && hasPrev) { event.preventDefault(); onIndexChange(index - 1); }
            if (event.key === 'ArrowRight' && hasNext) { event.preventDefault(); onIndexChange(index + 1); }
          }}
        >
          {item && (
            <>
              <DialogPrimitive.Title className="sr-only">{item.name}</DialogPrimitive.Title>
              <div className="flex flex-none items-center gap-3 px-4 py-3 text-white" onClick={(e) => e.stopPropagation()}>
                <span className="min-w-0 flex-1 truncate text-label">{item.name}</span>
                {items.length > 1 && <span className="flex-none text-label tabular-nums text-white/70">{index + 1} / {items.length}</span>}
                <a
                  href={item.src}
                  download={item.name}
                  aria-label="Baixar original"
                  className="grid size-9 flex-none place-items-center rounded-full text-white/80 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/60"
                >
                  <Download size={18} />
                </a>
                <DialogPrimitive.Close render={<CloseButton variant="overlay" size="md" />} />
              </div>
              <div className="relative flex min-h-0 flex-1 items-center justify-center px-4 pb-6 sm:px-16">
                <img
                  key={item.src}
                  src={item.src}
                  alt={item.name}
                  data-download-url={item.src}
                  data-download-name={item.name}
                  className="max-h-full max-w-full rounded-md object-contain shadow-popover"
                  onClick={(e) => e.stopPropagation()}
                />
                {items.length > 1 && (
                  <>
                    <button type="button" aria-label="Anterior" disabled={!hasPrev} onClick={(e) => { e.stopPropagation(); onIndexChange(index - 1); }} className={`${navButton} absolute left-2 top-1/2 -translate-y-1/2 sm:left-4`}>
                      <ChevronLeft size={22} />
                    </button>
                    <button type="button" aria-label="Próxima" disabled={!hasNext} onClick={(e) => { e.stopPropagation(); onIndexChange(index + 1); }} className={`${navButton} absolute right-2 top-1/2 -translate-y-1/2 sm:right-4`}>
                      <ChevronRight size={22} />
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

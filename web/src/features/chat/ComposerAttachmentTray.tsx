import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CloseButton } from '@/shared/ui/primitives/close-button';
import { DocumentAttachmentCard } from '@/features/media/DocumentAttachmentCard';
import { cn } from '@/shared/lib/utils';
import type { PendingAttachment } from './conversationDrafts';

interface ComposerAttachmentTrayProps {
  files: PendingAttachment[];
  onRemove: (id: string) => void;
  /** Where focus goes when the removed tile was the last one left. */
  fallbackFocusRef: RefObject<HTMLElement | null>;
}

/** The composer's not-yet-sent files — image previews plus a horizontal-
 * scrolling row of document tiles, each wide enough to read its name and
 * type before sending (see DocumentAttachmentCard). */
export function ComposerAttachmentTray({ files, onRemove, fallbackFocusRef }: ComposerAttachmentTrayProps) {
  // keyed by file id, not array index — an index shifts under every removal
  // (the tile after the removed one slides left), a stable id doesn't
  const removeButtonRefs = useRef(new Map<string, HTMLButtonElement | null>());
  // set at click time, consumed once `files` actually shrinks (the caller's
  // state update may not be synchronous) — see the effect below
  const pendingFocusIdRef = useRef<string | null>(null);
  const prevLengthRef = useRef(files.length);

  function handleRemove(id: string, index: number) {
    // captured from the list as it stood before removal: the id that will
    // end up where focus should land, either the next tile or the one before it
    pendingFocusIdRef.current = files[index + 1]?.id ?? files[index - 1]?.id ?? null;
    onRemove(id);
  }

  useEffect(() => {
    if (files.length < prevLengthRef.current) {
      const id = pendingFocusIdRef.current;
      const target = id ? removeButtonRefs.current.get(id) : null;
      (target ?? fallbackFocusRef.current)?.focus();
      pendingFocusIdRef.current = null;
    }
    prevLengthRef.current = files.length;
  }, [files, fallbackFocusRef]);

  return (
    <AnimatePresence initial={false}>
      {files.length > 0 && (
        <motion.div
          key="attachments"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
          className="overflow-hidden"
        >
          {/* one scrolling row keeps the tray from eating the history on a phone */}
          <div className="flex gap-2 overflow-x-auto px-2 pt-2">
            {files.map((item, index) => (
              <motion.div
                key={item.id}
                layout
                className={cn(
                  'relative flex-none overflow-hidden rounded-xl border border-white/10 bg-white/4',
                  item.previewUrl ? 'size-18' : 'flex w-65 max-w-full items-center gap-1 py-2.5 pl-2.5 pr-2'
                )}
              >
                {item.previewUrl ? (
                  <img src={item.previewUrl} alt={item.file.name} className="size-full object-cover" />
                ) : (
                  <DocumentAttachmentCard name={item.file.name} size={item.file.size} mime={item.file.type} className="min-w-0 flex-1" />
                )}
                <CloseButton
                  ref={(el) => { removeButtonRefs.current.set(item.id, el); }}
                  variant={item.previewUrl ? 'overlay' : 'ghost'}
                  size="xs"
                  label={`Remover ${item.file.name}`}
                  onClick={() => handleRemove(item.id, index)}
                  className={item.previewUrl ? 'absolute right-1 top-1' : 'flex-none'}
                />
              </motion.div>
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

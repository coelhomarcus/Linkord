import { AlertCircle } from 'lucide-react';
import { DocumentAttachmentCard } from '@/features/media/DocumentAttachmentCard';
import { UploadProgressBar } from '@/shared/UploadProgressBar';
import { cn } from '@/shared/lib/utils';
import type { OutboxAttachment } from './useMessageOutbox';

/** The files of a send still in the outbox: local previews while the server
 * has nothing to serve yet, each with its own progress or failure. */
export function PendingAttachments({ attachments }: { attachments: OutboxAttachment[] }) {
  return (
    <div className="mt-1.5 flex flex-wrap gap-2">
      {attachments.map((attachment) => {
        const done = attachment.progress >= 1;
        return (
          <div
            key={attachment.localId}
            title={attachment.name}
            className={cn(
              'relative overflow-hidden rounded-xl border bg-white/[0.04]',
              attachment.failed ? 'border-red/50' : 'border-white/10',
              attachment.previewUrl ? 'size-32' : 'flex w-60 max-w-full items-center p-2.5',
            )}
          >
            {attachment.previewUrl ? (
              <img src={attachment.previewUrl} alt={attachment.name} className={cn('size-full object-cover', !done && 'opacity-60')} />
            ) : (
              <DocumentAttachmentCard name={attachment.name} size={attachment.size} mime={attachment.mime} className="min-w-0" />
            )}
            {attachment.failed ? (
              <span className="absolute right-1.5 top-1.5 rounded-full bg-bg-primary/80 p-0.5 text-red" aria-label="Falhou">
                <AlertCircle size={16} />
              </span>
            ) : !done && (
              <div className="absolute inset-x-1.5 bottom-1.5"><UploadProgressBar progress={attachment.progress} /></div>
            )}
          </div>
        );
      })}
    </div>
  );
}

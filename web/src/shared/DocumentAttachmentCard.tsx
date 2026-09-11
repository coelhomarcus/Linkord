import { File as FileIcon } from 'lucide-react';
import { formatFileSize } from './lib/formatBytes';
import { cn } from './lib/utils';

function fileTypeLabel(name: string, mime: string): string {
  const ext = name.includes('.') ? name.split('.').pop() ?? '' : '';
  if (ext && ext.length <= 5) return ext.toUpperCase();
  const sub = mime.split('/')[1];
  return sub ? sub.slice(0, 4).toUpperCase() : 'ARQUIVO';
}

interface DocumentAttachmentCardProps {
  name: string;
  size: number;
  mime: string;
  className?: string;
}

/** Standardized "generic file" identity: type badge, name, size — used for
 * both a still-uploading attachment chip and the sent message's file card,
 * so a document reads the same everywhere in the app. */
export function DocumentAttachmentCard({ name, size, mime, className }: DocumentAttachmentCardProps) {
  return (
    <div className={cn('flex min-w-0 items-center gap-3', className)}>
      <div className="grid size-10 flex-none place-items-center rounded-lg bg-bg-secondary">
        <FileIcon size={20} className="text-text-muted" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-label font-medium text-text-secondary">{name}</p>
        <p className="truncate text-caption text-text-muted">
          {fileTypeLabel(name, mime)} · {formatFileSize(size)}
        </p>
      </div>
    </div>
  );
}

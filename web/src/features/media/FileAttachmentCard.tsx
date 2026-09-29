import { Download } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { DocumentAttachmentCard } from './DocumentAttachmentCard';

// One width for every state (draft, pending, published) — see the redesign
// plan's "usar uma única regra para documentos publicados e pendentes".
export const FILE_CARD_MAX_WIDTH = 360;

interface FileAttachmentCardProps {
  name: string;
  size: number;
  mime: string;
  url: string;
  maxWidth?: number;
  /** false drops the card's own border/background — used to embed this as
   * another card's header (see TextPreviewCard, which supplies its own
   * outer chrome plus a body below). */
  bordered?: boolean;
  className?: string;
}

/** The published surface: identity, metadata and an explicit download
 * control. Non-interactive container — only the download icon is a link,
 * so selecting the name never triggers a download and nothing nests a
 * button inside a link. */
export function FileAttachmentCard({ name, size, mime, url, maxWidth, bordered = true, className }: FileAttachmentCardProps) {
  return (
    <div
      style={maxWidth ? { maxWidth } : undefined}
      className={cn(
        'flex w-full min-w-0 items-center gap-2 px-3 py-2.5',
        bordered ? 'rounded-xl border border-white/10 bg-bg-tertiary' : 'transition-colors hover:bg-bg-hover',
        className
      )}
    >
      <DocumentAttachmentCard name={name} size={size} mime={mime} className="min-w-0 flex-1" />
      <a
        href={url}
        download={name}
        aria-label={`Baixar ${name}`}
        className="grid size-11 flex-none place-items-center rounded-lg text-text-muted transition-colors hover:bg-white/[0.06] hover:text-text-primary focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <Download size={18} />
      </a>
    </div>
  );
}

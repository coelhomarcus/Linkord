import { useId } from 'react';
import type { ReactNode } from 'react';
import { cn } from '@/shared/lib/utils';

/** A vertical section of a detail page: a title, what it is for, its content,
 * and a divider above every one but the first — a sequence, not a mosaic of
 * cards. `danger` marks the irreversible ones. */
export function AdminSection({ title, description, danger, children, className }: {
  title: string;
  description?: ReactNode;
  danger?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className={cn('flex flex-col gap-3 border-t border-white/10 pt-6 first:border-t-0 first:pt-0', className)}>
      <div className="flex flex-col gap-0.5">
        <h3 id={headingId} className={cn('text-title font-semibold', danger ? 'text-red-text' : 'text-text-primary')}>{title}</h3>
        {description && <p className="text-label text-text-muted">{description}</p>}
      </div>
      {children}
    </section>
  );
}

/** "label → value" rows: the metadata of an entity, aligned. */
export function AdminFields({ children }: { children: ReactNode }) {
  return <dl className="flex flex-col divide-y divide-white/5">{children}</dl>;
}

export function AdminFieldRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-6 gap-y-0.5 py-2.5">
      <dt className="w-44 flex-none text-label text-text-muted">{label}</dt>
      <dd className="min-w-0 flex-1 basis-56 break-words text-label text-text-primary">{children}</dd>
    </div>
  );
}

/** One action: what it does and what it affects on the left, its button on the
 * right (under the text when the width is short). */
export function AdminActionRow({ title, description, note, children }: {
  title: string;
  description: ReactNode;
  /** why the action is unavailable, when it is */
  note?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-2.5">
      <div className="min-w-0 flex-1 basis-64">
        <p className="text-body font-medium text-text-primary">{title}</p>
        <p className="text-label text-text-muted">{description}</p>
        {note && <p className="mt-1 text-caption text-text-secondary">{note}</p>}
      </div>
      <div className="flex flex-none flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

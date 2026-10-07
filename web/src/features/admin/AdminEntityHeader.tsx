import type { ReactNode } from 'react';
import { CopyIdButton } from './CopyIdButton';

/** Who or what an admin detail page is about: an avatar, a name, a secondary
 * line, the badges that say its state, and the id — copyable, and breakable so
 * a long one never widens the page. */
export function AdminEntityHeader({ avatar, title, subtitle, id, badges }: {
  avatar: ReactNode;
  title: string;
  subtitle?: string;
  id: string;
  badges?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-3">
      <div className="flex-none">{avatar}</div>
      <div className="min-w-0 flex-1 basis-60">
        <h2 className="truncate text-display font-bold text-text-primary">{title}</h2>
        {subtitle && <p className="truncate text-label text-text-muted">{subtitle}</p>}
        <p className="mt-0.5 flex items-center gap-1 text-caption text-text-muted">
          <span className="min-w-0 break-all font-mono">{id}</span>
          <CopyIdButton id={id} label={`Copiar ID de ${title}`} />
        </p>
      </div>
      {badges && <div className="flex flex-none flex-wrap items-center gap-2">{badges}</div>}
    </header>
  );
}

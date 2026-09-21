import type { ReactNode } from 'react';

/** "TITLE — count" above a list, Discord-style: small caps title, the count as its
 * own text so it can be read (and tested) on its own. */
export function ListSectionHeader({ id, title, count }: { id?: string; title: string; count?: ReactNode }) {
  return (
    <div className="mb-1 flex items-baseline gap-2 border-b border-white/10 pb-2">
      <h2 id={id} className="text-caption font-bold uppercase tracking-[0.02em] text-text-secondary">{title}</h2>
      {count !== undefined && <span className="text-caption text-text-muted">{count}</span>}
    </div>
  );
}

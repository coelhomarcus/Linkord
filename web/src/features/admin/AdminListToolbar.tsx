import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import { Button } from '@/shared/ui/primitives/button';
import { cn } from '@/shared/lib/utils';

const FIELD = 'h-9 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 text-label text-text-primary outline-none focus-visible:ring-2 focus-visible:ring-ring';

export function AdminSelectField<T extends string>({ label, value, onChange, options }: {
  label: string;
  value: T;
  onChange: (next: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-caption text-text-muted">
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value as T)} className={cn(FIELD, 'text-text-primary')}>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

export function AdminDateField({ label, value, onChange }: { label: string; value: string; onChange: (next: string) => void }) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-caption text-text-muted">
      {label}
      <input type="date" value={value} onChange={(event) => onChange(event.target.value)} className={FIELD} />
    </label>
  );
}

/** Search, inline filters, an optional "more filters" disclosure and a one-line
 * summary of what is loaded. Fields wrap instead of overflowing, so the same
 * toolbar serves the wide and the compact layout. */
export function AdminListToolbar({ search, filters, advanced, advancedActive, summary, onClear }: {
  /** omitted for a list with nothing to search by */
  search?: { value: string; onChange: (next: string) => void; placeholder: string; label: string };
  filters?: ReactNode;
  /** rarely used filters (a period…), folded behind a button */
  advanced?: ReactNode;
  advancedActive?: boolean;
  summary?: ReactNode;
  /** present when any filter differs from its default */
  onClear?: () => void;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const panelId = useId();
  const open = advancedOpen || advancedActive === true;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        {search && (
          <div className="flex h-9 min-w-56 flex-1 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3">
            <Search size={15} aria-hidden className="flex-none text-text-muted" />
            <input
              value={search.value}
              onChange={(event) => search.onChange(event.target.value)}
              placeholder={search.placeholder}
              aria-label={search.label}
              className="h-full min-w-0 flex-1 bg-transparent text-label outline-none placeholder:text-text-muted"
            />
          </div>
        )}
        {filters}
        {advanced && (
          <Button type="button" variant="secondary" size="sm" className="h-9" aria-expanded={open} aria-controls={panelId} onClick={() => setAdvancedOpen((v) => !v)}>
            Mais filtros
            <ChevronDown size={14} aria-hidden className={cn('transition-transform', open && 'rotate-180')} />
          </Button>
        )}
      </div>
      {advanced && open && <div id={panelId} className="flex flex-wrap items-end gap-3">{advanced}</div>}
      {(summary || onClear) && (
        <div className="flex flex-wrap items-center gap-3 text-caption text-text-muted">
          {summary && <p aria-live="polite">{summary}</p>}
          {onClear && <Button type="button" variant="ghost" size="xs" onClick={onClear}>Limpar filtros</Button>}
        </div>
      )}
    </div>
  );
}

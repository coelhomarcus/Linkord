import { Link, useLocation } from 'react-router';
import { cn } from '@/shared/lib/utils';

export interface DetailTab<T extends string> { id: T; label: string }

/** Sub-sections of a detail page, each with its own URL (`?tab=`), so a link or a
 * reload lands on it. They are links, not a widget with its own state: the URL
 * is the only source of truth. The row scrolls sideways on its own when the
 * width runs out — never the page. */
export function AdminDetailTabs<T extends string>({ label, tabs, active, defaultTab }: {
  label: string;
  tabs: DetailTab<T>[];
  active: T;
  defaultTab: T;
}) {
  const { pathname, state } = useLocation();
  return (
    <nav aria-label={label} className="-mx-1 overflow-x-auto px-1">
      <ul className="flex min-w-max gap-1 border-b border-white/10">
        {tabs.map((tab) => {
          const current = tab.id === active;
          return (
            <li key={tab.id}>
              <Link
                // the list the admin came from travels with every tab, so "back" still knows it
                to={{ pathname, search: tab.id === defaultTab ? '' : `?tab=${tab.id}` }}
                state={state}
                aria-current={current ? 'page' : undefined}
                className={cn(
                  '-mb-px flex h-10 items-center border-b-2 px-3 text-label font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
                  current ? 'border-primary text-text-primary' : 'border-transparent text-text-muted hover:text-text-secondary',
                )}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

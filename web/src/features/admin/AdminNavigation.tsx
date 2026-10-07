import { ChevronRight } from 'lucide-react';
import { NavLink } from 'react-router';
import { cn } from '@/shared/lib/utils';
import { ADMIN_GROUPS, adminSectionPath } from './adminCatalog';

function GroupLabel({ children }: { children: string }) {
  return <p className="select-none px-2.5 pb-1 text-caption font-bold uppercase tracking-[0.02em] text-text-secondary">{children}</p>;
}

/** The permanent section sidebar of a wide admin area. A detail page keeps its
 * section marked: NavLink matches by path prefix. */
export function AdminSidebar() {
  return (
    <nav aria-label="Administração" className="flex w-60 flex-none flex-col overflow-y-auto border-r border-white/10 p-3">
      {ADMIN_GROUPS.map((group) => (
        <div key={group.label} className="flex flex-col gap-0.5 pt-4 first:pt-0">
          <GroupLabel>{group.label}</GroupLabel>
          {group.sections.map((section) => {
            const Icon = section.icon;
            return (
              <NavLink
                key={section.id}
                to={adminSectionPath(section)}
                className={({ isActive }) => cn(
                  'flex h-10 items-center gap-2 rounded-lg px-2.5 text-body font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
                  isActive ? 'bg-white/10 text-text-primary' : 'text-text-muted hover:bg-white/5 hover:text-text-secondary',
                )}
              >
                <Icon size={16} aria-hidden className="flex-none" />
                <span className="truncate">{section.label}</span>
              </NavLink>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

/** The compact landing screen: the same groups, icons and labels as the
 * sidebar, one full-width row each. */
export function AdminIndex() {
  return (
    <nav aria-label="Administração" className="flex flex-col gap-1">
      {ADMIN_GROUPS.map((group) => (
        <div key={group.label} className="flex flex-col gap-0.5 pt-4 first:pt-0">
          <GroupLabel>{group.label}</GroupLabel>
          {group.sections.map((section) => {
            const Icon = section.icon;
            return (
              <NavLink
                key={section.id}
                to={adminSectionPath(section)}
                className="flex min-h-11 items-center gap-3 rounded-lg px-2.5 text-body font-medium text-text-primary outline-none transition-colors hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Icon size={18} aria-hidden className="flex-none text-text-muted" />
                <span className="min-w-0 flex-1 truncate">{section.label}</span>
                <ChevronRight size={16} aria-hidden className="flex-none text-text-muted" />
              </NavLink>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

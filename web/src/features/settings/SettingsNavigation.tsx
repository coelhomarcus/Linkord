import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router';
import { ROUTES } from '@/shared/lib/routes';
import type { SettingsTab } from '@/shared/lib/routes';
import { cn } from '@/shared/lib/utils';
import { FROM_INDEX_STATE, visibleGroups } from './settingsCatalog';

function GroupLabel({ children }: { children: string }) {
  return <p className="select-none px-2.5 pb-1 text-caption font-bold uppercase tracking-[0.02em] text-text-secondary">{children}</p>;
}

/** The permanent category sidebar of a wide settings area. */
export function SettingsSidebar({ active, isAdmin }: { active: SettingsTab; isAdmin: boolean }) {
  return (
    <nav aria-label="Categorias de ajustes" className="flex w-64 flex-none flex-col gap-0.5 overflow-y-auto border-r border-white/10 p-3">
      {visibleGroups(isAdmin).map((group) => (
        <div key={group.label} className="flex flex-col gap-0.5 pt-4 first:pt-0">
          <GroupLabel>{group.label}</GroupLabel>
          {group.categories.map((category) => {
            const Icon = category.icon;
            const current = category.id === active;
            return (
              <Link
                key={category.id}
                to={ROUTES.settingsTab(category.id)}
                aria-current={current ? 'page' : undefined}
                className={cn(
                  'flex h-9 items-center gap-2 rounded-lg px-2.5 text-body font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
                  current ? 'bg-primary/12 text-text-primary' : 'text-text-muted hover:bg-white/[0.05] hover:text-text-secondary',
                )}
              >
                <Icon size={16} aria-hidden className="flex-none" />
                <span className="truncate">{category.label}</span>
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

/** The compact landing screen: the same groups, icons and labels as the sidebar,
 * one full-width row each. */
export function SettingsIndex({ isAdmin }: { isAdmin: boolean }) {
  return (
    <nav aria-label="Categorias de ajustes" className="flex flex-col gap-1 px-4 py-4 @[520px]:px-6">
      {visibleGroups(isAdmin).map((group) => (
        <div key={group.label} className="flex flex-col gap-0.5 pt-4 first:pt-0">
          <GroupLabel>{group.label}</GroupLabel>
          {group.categories.map((category) => {
            const Icon = category.icon;
            return (
              <Link
                key={category.id}
                to={ROUTES.settingsTab(category.id)}
                state={FROM_INDEX_STATE}
                className="flex min-h-11 items-center gap-3 rounded-lg px-2.5 text-body font-medium text-text-primary outline-none transition-colors hover:bg-white/[0.05] focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Icon size={18} aria-hidden className="flex-none text-text-muted" />
                <span className="min-w-0 flex-1 truncate">{category.label}</span>
                <ChevronRight size={16} aria-hidden className="flex-none text-text-muted" />
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

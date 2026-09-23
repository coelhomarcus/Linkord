import { ChevronRight, Search } from 'lucide-react';
import { Link } from 'react-router';
import { ROUTES } from '@/shared/lib/routes';
import type { SettingsTab } from '@/shared/lib/routes';
import { cn } from '@/shared/lib/utils';
import { CloseButton } from '@/shared/ui/primitives/close-button';
import { FROM_INDEX_STATE, findCategory, visibleGroups } from './settingsCatalog';
import { useSettingsSearch } from './useSettingsSearch';
import type { SettingsSearchResult } from './useSettingsSearch';

function GroupLabel({ children }: { children: string }) {
  return <p className="select-none px-2.5 pb-1 text-caption font-bold uppercase tracking-[0.02em] text-text-secondary">{children}</p>;
}

function SettingsSearchField({ query, onChange, onClear }: { query: string; onChange: (value: string) => void; onClear: () => void }) {
  return (
    <div className="mb-3 flex flex-none items-center gap-2 rounded-xl border border-white/10 bg-white/[0.045] px-3">
      <Search size={15} className="flex-none text-text-muted" aria-hidden />
      <input
        value={query}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Buscar nas configurações"
        aria-label="Buscar nas configurações"
        className="h-9 min-w-0 flex-1 bg-transparent text-label outline-none placeholder:text-text-muted"
      />
      {query && <CloseButton size="xs" label="Limpar busca" onClick={onClear} />}
    </div>
  );
}

/** The single-column results list, shared by both nav surfaces — a search
 * result is already a flat list regardless of which one triggered it. */
function SettingsSearchResults({ results, query }: { results: SettingsSearchResult[]; query: string }) {
  if (results.length === 0) {
    return <p className="px-2.5 py-4 text-label text-text-muted">Nada encontrado para "{query}".</p>;
  }
  return (
    <div className="flex flex-col gap-0.5">
      {results.map(({ entry, categoryLabel }) => {
        const category = findCategory(entry.categoryId);
        const Icon = category.icon;
        const to = entry.sectionId ? `${ROUTES.settingsTab(entry.categoryId)}#${entry.sectionId}` : ROUTES.settingsTab(entry.categoryId);
        return (
          <Link
            key={`${entry.categoryId}-${entry.sectionId ?? ''}`}
            to={to}
            className="flex min-h-11 items-center gap-3 rounded-lg px-2.5 text-body font-medium text-text-primary outline-none transition-colors hover:bg-white/[0.05] focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Icon size={16} aria-hidden className="flex-none text-text-muted" />
            <span className="min-w-0 flex-1">
              <span className="block truncate">{entry.title}</span>
              <span className="block truncate text-caption text-text-muted">{categoryLabel}</span>
            </span>
          </Link>
        );
      })}
    </div>
  );
}

/** The permanent category sidebar of a wide settings area. */
export function SettingsSidebar({ active, isAdmin }: { active: SettingsTab; isAdmin: boolean }) {
  const { query, setQuery, results } = useSettingsSearch(isAdmin);
  return (
    <nav aria-label="Categorias de ajustes" className="flex w-64 flex-none flex-col overflow-y-auto border-r border-white/10 p-3">
      <SettingsSearchField query={query} onChange={setQuery} onClear={() => setQuery('')} />
      {query ? (
        <SettingsSearchResults results={results} query={query} />
      ) : (
        <div className="flex flex-col gap-0.5">
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
                      // Discord/Fluxer: a plain light-gray wash for the
                      // active item, no accent color.
                      current ? 'bg-white/10 text-text-primary' : 'text-text-muted hover:bg-white/[0.05] hover:text-text-secondary',
                    )}
                  >
                    <Icon size={16} aria-hidden className="flex-none" />
                    <span className="truncate">{category.label}</span>
                  </Link>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </nav>
  );
}

/** The compact landing screen: the same groups, icons and labels as the sidebar,
 * one full-width row each. */
export function SettingsIndex({ isAdmin }: { isAdmin: boolean }) {
  const { query, setQuery, results } = useSettingsSearch(isAdmin);
  return (
    <nav aria-label="Categorias de ajustes" className="flex flex-col px-4 py-4 @[520px]:px-6">
      <SettingsSearchField query={query} onChange={setQuery} onClear={() => setQuery('')} />
      {query ? (
        <SettingsSearchResults results={results} query={query} />
      ) : (
        <div className="flex flex-col gap-1">
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
        </div>
      )}
    </nav>
  );
}

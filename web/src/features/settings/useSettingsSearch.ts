import { useMemo, useState } from 'react';
import { findCategory } from './settingsCatalog';
import { SETTINGS_SEARCH_INDEX } from './settingsSearchIndex';
import type { SearchEntry } from './settingsSearchIndex';

/** Accent/case-insensitive: "camera" has to find "Câmera" (plano §5.3). No
 * existing helper for this in the repo — small enough not to need one. */
export function normalizeSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

export interface SettingsSearchResult {
  entry: SearchEntry;
  categoryLabel: string;
}

export function useSettingsSearch(isAdmin: boolean) {
  const [query, setQuery] = useState('');

  const visibleEntries = useMemo(
    () => SETTINGS_SEARCH_INDEX.filter((entry) => isAdmin || !entry.adminOnly),
    [isAdmin],
  );

  const results = useMemo((): SettingsSearchResult[] => {
    const q = normalizeSearchText(query);
    if (!q) return [];
    return visibleEntries
      .map((entry) => ({ entry, categoryLabel: findCategory(entry.categoryId).label }))
      .filter(({ entry, categoryLabel }) => {
        const haystack = normalizeSearchText([entry.title, categoryLabel, ...entry.keywords].join(' '));
        return haystack.includes(q);
      });
  }, [query, visibleEntries]);

  return { query, setQuery, results };
}

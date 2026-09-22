import { useEffect, useState } from 'react';
import { useDebouncedValue } from './useDebouncedValue';

/** A search box whose text lives in the URL (`?q=`). Typing answers at once and
 * reaches the URL (and the server) once it settles; an outside change of `q`
 * (Back, a link) replaces the text. `search` is the settled, trimmed value. */
export function useUrlSearch(query: string, onQueryChange: (next: string) => void) {
  const [value, setValue] = useState(query);
  const search = useDebouncedValue(value.trim(), 250);

  // the URL is the source: adjusted during render, not from an effect
  const [seenQuery, setSeenQuery] = useState(query);
  if (query !== seenQuery) {
    setSeenQuery(query);
    setValue(query);
  }

  useEffect(() => { if (search !== query.trim()) onQueryChange(search); }, [search]); // eslint-disable-line react-hooks/exhaustive-deps

  return { value, setValue, search };
}

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router';

export interface QueryField {
  default: string;
  /** a closed set of values; anything else in the URL falls back to the default */
  allowed?: readonly string[];
}

export type QuerySchema<K extends string> = Record<K, QueryField>;

function read(params: URLSearchParams, key: string, field: QueryField): string {
  const raw = params.get(key);
  if (raw === null) return field.default;
  if (field.allowed) return field.allowed.includes(raw) ? raw : field.default;
  return raw.trim();
}

/** The filters of an admin list, kept in the URL.
 *
 * Only the keys of `schema` exist: unknown params are ignored on read and
 * dropped on write, and a value outside `allowed` reads as the default, so a
 * hand-edited or stale link can't put the list in a state the UI has no
 * control for. Defaults are omitted from the URL (`/admin/users` stays clean).
 * Writes replace the history entry: Back leaves the list instead of undoing
 * one filter click at a time. `schema` must be a module-level constant. */
export function useAdminQuery<K extends string>(schema: QuerySchema<K>) {
  const [params, setParams] = useSearchParams();

  const filters = useMemo(() => {
    const result = {} as Record<K, string>;
    for (const key of Object.keys(schema) as K[]) result[key] = read(params, key, schema[key]);
    return result;
  }, [params, schema]);

  // react-router's functional setSearchParams does NOT queue like setState: two
  // updates in one tick would both start from the same stale params and the
  // second would erase the first. Chain them here until the router catches up.
  const pending = useRef<URLSearchParams | null>(null);
  useEffect(() => { pending.current = null; }, [params]);

  /** Merges `patch` into the latest params, so several fields settling in the
   * same tick (debounced inputs) don't overwrite each other. */
  const update = useCallback((patch: Partial<Record<K, string>>) => {
    const basis = pending.current ?? params;
    const next = new URLSearchParams();
    for (const key of Object.keys(schema) as K[]) {
      const value = key in patch ? (patch[key] ?? '') : read(basis, key, schema[key]);
      if (value && value !== schema[key].default) next.set(key, value);
    }
    pending.current = next;
    setParams(next, { replace: true });
  }, [params, setParams, schema]);

  const clear = useCallback(() => {
    const reset = {} as Partial<Record<K, string>>;
    for (const key of Object.keys(schema) as K[]) reset[key] = schema[key].default;
    update(reset);
  }, [update, schema]);

  const active = (Object.keys(schema) as K[]).some((key) => filters[key] !== schema[key].default);

  /** What the list is: a stable structured key for `useCursorList` (never a
   * joined string — a search text may contain any separator). */
  const identity = useMemo(() => JSON.stringify(filters), [filters]);

  return { filters, update, clear, active, identity };
}

import { useLocation } from 'react-router';

/** Carried by a link from a list to a detail, so the detail's "back" can return
 * to the exact query (filters and all) the admin came from. */
export interface FromListState { from: string }

export function fromList(pathname: string, search: string): FromListState {
  return { from: `${pathname}${search}` };
}

/** Where "back" goes: the list query the admin came from, when that is an
 * internal admin URL of the same list; otherwise the plain list. A direct
 * access (or a tampered history state) lands on the fallback, never elsewhere. */
export function useAdminBack(fallback: string): string {
  const state = useLocation().state as Partial<FromListState> | null;
  const from = state?.from;
  if (typeof from === 'string' && (from === fallback || from.startsWith(`${fallback}?`))) return from;
  return fallback;
}

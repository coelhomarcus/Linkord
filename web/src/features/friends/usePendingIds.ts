import { useCallback, useRef, useState } from 'react';

/** One in-flight action PER row: a second click on the same person/invitation is
 * ignored, while every other row stays usable. `run` returns null when that id was
 * already busy; otherwise the outcome of `action`. */
export function usePendingIds() {
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const inFlight = useRef(new Set<string>());

  const run = useCallback(async <T,>(id: string, action: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: unknown } | null> => {
    if (inFlight.current.has(id)) return null;
    inFlight.current.add(id);
    setPending(new Set(inFlight.current));
    try {
      return { ok: true, value: await action() };
    } catch (error) {
      return { ok: false, error };
    } finally {
      inFlight.current.delete(id);
      setPending(new Set(inFlight.current));
    }
  }, []);

  return { isPending: (id: string) => pending.has(id), run };
}

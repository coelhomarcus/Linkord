import { useLayoutEffect, useState } from 'react';
import type { RefObject } from 'react';

export type AdminMode = 'wide' | 'compact';

/** Below this width of the admin AREA (not the window: the rail and the
 * conversation sidebar already took their share) the section sidebar no longer
 * fits next to the content, and navigation becomes an index. */
export const ADMIN_WIDE_MIN = 960;

export function adminModeForWidth(width: number): AdminMode {
  // 0 means "not measured yet" (first paint, jsdom): never start compact by accident
  if (width <= 0) return 'wide';
  return width >= ADMIN_WIDE_MIN ? 'wide' : 'compact';
}

export interface AdminLayoutState {
  mode: AdminMode;
  /** false until the area has been measured once: `mode` is only a guess before that */
  measured: boolean;
}

/** Observes a wrapper whose width doesn't depend on the mode itself. */
export function useAdminLayout(ref: RefObject<HTMLElement | null>): AdminLayoutState {
  const [state, setState] = useState<AdminLayoutState>({ mode: 'wide', measured: false });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const mode = adminModeForWidth(el.getBoundingClientRect().width);
      // a resize that doesn't cross the threshold must not re-render the whole area
      setState((previous) => (previous.measured && previous.mode === mode ? previous : { mode, measured: true }));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);

  return state;
}

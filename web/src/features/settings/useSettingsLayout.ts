import { useLayoutEffect, useState } from 'react';
import type { RefObject } from 'react';

export type SettingsMode = 'wide' | 'compact';

/** Below this width of the settings AREA (not the window: the global sidebar
 * already took its share) the sidebar of categories no longer fits next to the
 * content, and settings switch to index → detail. */
export const SETTINGS_WIDE_MIN = 960;

export function modeForWidth(width: number): SettingsMode {
  // 0 means "not measured yet" (first paint, jsdom): never start compact by accident
  if (width <= 0) return 'wide';
  return width >= SETTINGS_WIDE_MIN ? 'wide' : 'compact';
}

/** Observes a wrapper whose width doesn't depend on the mode itself. */
export function useSettingsLayout(ref: RefObject<HTMLElement | null>): SettingsMode {
  const [mode, setMode] = useState<SettingsMode>('wide');

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setMode(modeForWidth(el.getBoundingClientRect().width));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);

  return mode;
}

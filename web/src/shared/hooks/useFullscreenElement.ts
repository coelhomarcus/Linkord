import { useEffect, useState } from 'react';

/** The element currently in the browser's native Fullscreen mode, or null —
 * kept in sync with `fullscreenchange` so it reacts correctly to Escape/F11,
 * not just to this app's own request/exit calls. Menus and popovers portal
 * into this element (when set) instead of `document.body`, which the
 * Fullscreen API renders on top of and so would otherwise hide them.
 * `document.fullscreenElement` types as the generic DOM `Element`, but
 * every element this app ever requests fullscreen on is an `HTMLElement`. */
export function useFullscreenElement(): HTMLElement | null {
  const [element, setElement] = useState<HTMLElement | null>(() => (document.fullscreenElement as HTMLElement | null) ?? null);

  useEffect(() => {
    function sync() {
      setElement((document.fullscreenElement as HTMLElement | null) ?? null);
    }
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);

  return element;
}

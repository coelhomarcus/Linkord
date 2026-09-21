import { useLayoutEffect, useState } from 'react';
import type { RefObject } from 'react';

/** Width of an element, tracked with a ResizeObserver: for layout decisions that
 * depend on the AREA a page gets (after the sidebars), not on the window. 0 until
 * measured (and always in jsdom) — callers treat 0 as "unknown, use the wide layout". */
export function useElementWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(Math.round(el.getBoundingClientRect().width));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);

  return width;
}

import { useEffect, useState } from 'react';
import type { RefObject } from 'react';

// Within this distance of the visible area the card starts loading, so it
// is usually ready by the time it scrolls in.
const NEAR_MARGIN = '600px 0px';

/** True once `ref` comes near the visible part of its scroll container (the
 * chat list, marked data-scroll-root; the viewport otherwise). Stays true:
 * scrolling away doesn't cancel what already started. */
export function useNearViewport(ref: RefObject<HTMLElement | null>): boolean {
  const [near, setNear] = useState(() => typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    const el = ref.current;
    if (near || !el) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { setNear(true); observer.disconnect(); }
    }, { root: el.closest('[data-scroll-root]'), rootMargin: NEAR_MARGIN });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, near]);
  return near;
}

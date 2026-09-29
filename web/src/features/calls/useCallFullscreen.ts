import { useCallback, useEffect, useState } from 'react';
import type { RefObject } from 'react';
import { useFullscreenElement } from '@/shared/hooks/useFullscreenElement';

interface CallFullscreenApi {
  /** True specifically when THIS container (the call stage) is the
   * fullscreen element — a single tile going fullscreen (TileMenu's own
   * "Tela cheia") does not count as the call being expanded. */
  isCallFullscreen: boolean;
  toggleCallFullscreen: () => Promise<void>;
  /** Whatever element is ACTUALLY fullscreen right now, if any — the stage,
   * or a single tile. Menus/popovers portal into this instead of
   * `document.body`, which the Fullscreen API would otherwise render under. */
  fullscreenElement: HTMLElement | null;
}

/** Browser fullscreen for the whole call view (Stage + control bar), with a
 * graceful fallback per the calls redesign plan §10: if the Fullscreen API
 * doesn't exist or the request fails, the call simply stays in its already-
 * expanded (non-fullscreen) view — never a broken or half-applied state. */
export function useCallFullscreen(containerRef: RefObject<HTMLElement | null>): CallFullscreenApi {
  const fullscreenElement = useFullscreenElement();
  // Compared in an effect, not inline during render — reading `.current`
  // synchronously in the render body is unsafe (React docs: refs are for
  // effects/handlers, not rendering).
  const [isCallFullscreen, setIsCallFullscreen] = useState(false);
  useEffect(() => {
    setIsCallFullscreen(fullscreenElement !== null && fullscreenElement === containerRef.current);
  }, [fullscreenElement, containerRef]);

  const toggleCallFullscreen = useCallback(async () => {
    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => {});
      return;
    }
    const el = containerRef.current;
    if (!el?.requestFullscreen || document.fullscreenEnabled === false) return;
    await el.requestFullscreen().catch(() => {});
  }, [containerRef]);

  return { isCallFullscreen, toggleCallFullscreen, fullscreenElement };
}

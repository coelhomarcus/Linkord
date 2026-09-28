import { useCallback, useEffect, useRef, useState } from 'react';

const IDLE_TIMEOUT_MS = 2500;
// Not per-event (mousemove fires dozens of times/sec) — a slow poll against a
// timestamp is effectively free, where a setTimeout/clearTimeout churn on
// every pixel of movement would not be (plan §11.2: "medir... antes de
// otimizar", applied conservatively here without a literal profiling pass).
const CHECK_INTERVAL_MS = 400;
const ACTIVITY_EVENTS = ['mousemove', 'keydown', 'pointerdown', 'touchstart'] as const;

export interface CallHudApi {
  hudVisible: boolean;
  /** Also whatever "activity" itself resolves to — exposed so a caller can
   * force a reveal from a non-DOM-event source (e.g. opening a menu
   * programmatically), though `suspend` covers the common case already. */
  revealHud: () => void;
}

/** Auto-hides the call's floating controls after a period with no mouse,
 * keyboard, or touch activity — so they don't permanently cover the video
 * underneath (plan §11.3). `suspend` (a tile menu open, reconnecting, an
 * actionable error) forces it visible and pauses the idle countdown
 * regardless of the timer. */
export function useCallHud(suspend: boolean): CallHudApi {
  const [hudVisible, setHudVisible] = useState(true);
  const lastActivityRef = useRef(Date.now());

  const revealHud = useCallback(() => {
    lastActivityRef.current = Date.now();
    setHudVisible(true);
  }, []);

  useEffect(() => {
    if (suspend) {
      setHudVisible(true);
      return;
    }
    revealHud();
    for (const ev of ACTIVITY_EVENTS) window.addEventListener(ev, revealHud, { passive: true });
    const interval = setInterval(() => {
      if (Date.now() - lastActivityRef.current >= IDLE_TIMEOUT_MS) setHudVisible(false);
    }, CHECK_INTERVAL_MS);
    return () => {
      for (const ev of ACTIVITY_EVENTS) window.removeEventListener(ev, revealHud);
      clearInterval(interval);
    };
  }, [suspend, revealHud]);

  return { hudVisible, revealHud };
}

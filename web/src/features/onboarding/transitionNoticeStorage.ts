// The "what changed" card is shown once per browser. Versioned so a future
// notice can be shown again without resurrecting this one.
export const TRANSITION_NOTICE_KEY = 'linkord.transition-notice.v1';

/** Storage can throw (private mode, blocked site data) — in that case the notice
 * simply shows every load until dismissed for the session, never breaks the app. */
export function wasTransitionNoticeDismissed(): boolean {
  try { return localStorage.getItem(TRANSITION_NOTICE_KEY) === '1'; } catch { return false; }
}

export function rememberTransitionNoticeDismissed(): void {
  try { localStorage.setItem(TRANSITION_NOTICE_KEY, '1'); } catch { /* nothing to persist to */ }
}

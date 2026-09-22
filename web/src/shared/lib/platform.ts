/** Whether this is running on a Mac — the one platform where the shortcut
 * modifier shown to the user should read "⌘" instead of "Ctrl" (the browser
 * itself still accepts either `metaKey` or `ctrlKey`, this is only about the
 * label). `userAgentData.platform` is the modern, spec'd way to ask
 * (Chromium); other browsers fall back to the deprecated `navigator.platform`,
 * then `userAgent` as a last resort. */
export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  const uaData = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  if (uaData?.platform) return /mac/i.test(uaData.platform);
  return /mac/i.test(navigator.platform || navigator.userAgent);
}

/** "⌘" on a Mac, "Ctrl" everywhere else (Windows, Linux, ChromeOS, …) — the
 * label for a Cmd/Ctrl+key shortcut hint. */
export function shortcutModifierLabel(): string {
  return isMacPlatform() ? '⌘' : 'Ctrl';
}

/** "⌘K" on a Mac, "Ctrl+K" everywhere else — a "+" between the modifier and
 * the key only when the modifier is spelled out as a word ("Ctrl"), not for
 * the Mac glyph, which already reads as a single unit on its own (the
 * platform's own convention, e.g. how macOS itself lists shortcuts). */
export function shortcutHint(key: string): string {
  const mod = shortcutModifierLabel();
  return isMacPlatform() ? `${mod}${key}` : `${mod}+${key}`;
}

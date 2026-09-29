import { useEffect, useRef } from 'react';
import type { TileDescriptor } from './tileTypes';

/** Suggests focus onto a screen share the moment it starts — but never
 * overrides a focus the viewer picked themselves (calls redesign plan §6.2:
 * "nunca substituir um foco manual ativo"). Only reacts to a screen key
 * that's genuinely new since the last render — a share that was already
 * active when this mounted (joining mid-share) isn't "someone just started
 * sharing", so the first render only records what's there without focusing
 * it. */
export function useAutoFocusScreenShare(
  descriptors: TileDescriptor[],
  focusOrigin: 'manual' | 'automatic' | 'capacity' | null,
  onAutoFocus: (key: string) => void,
): void {
  const seenScreenKeysRef = useRef<Set<string> | null>(null);

  useEffect(() => {
    const currentScreenKeys = new Set(descriptors.filter((d) => d.kind === 'screen').map((d) => d.key));
    const seen = seenScreenKeysRef.current;
    seenScreenKeysRef.current = currentScreenKeys;
    if (!seen) return;
    if (focusOrigin === 'manual') return;

    for (const key of currentScreenKeys) {
      if (!seen.has(key)) { onAutoFocus(key); return; }
    }
  }, [descriptors, focusOrigin, onAutoFocus]);
}

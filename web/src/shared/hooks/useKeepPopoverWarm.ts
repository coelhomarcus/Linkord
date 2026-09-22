import { useState } from 'react';

/** Whether a popover/menu's content should stay mounted (hidden by its own
 * closed styling — see `PopoverContent`/`ContextMenuContent`'s `keepMounted`)
 * instead of being torn down every time it closes. Lazy: nothing mounts
 * before the first real open, so a trigger nobody ever touches costs
 * nothing; once opened, every later open reuses the already-warm instance
 * instead of remounting it from scratch — the fix for content whose mount
 * itself is expensive (the emoji picker fetches/parses/measures its whole
 * dataset on every mount, which is what made it visibly stutter on every
 * single open before this). */
export function useKeepPopoverWarm(open: boolean): boolean {
  const [warmed, setWarmed] = useState(false);
  if (open && !warmed) setWarmed(true);
  return warmed;
}

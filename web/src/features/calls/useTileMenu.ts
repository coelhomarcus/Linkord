import { useCallback, useRef, useState } from 'react';
import type { AnchorRect } from '@/state/RoomContext';
import type { TileKind } from './tileTypes';

/** The right-click/long-press menu on a call tile — which tile it's for and
 * where to anchor it. `menuOpenRef` exists alongside the `menuTarget` state
 * so `closeTileMenu` can report whether it actually closed something open
 * (used to distinguish "this click closed the menu" from "this click did
 * something else") without waiting on a state read. */
export function useTileMenu() {
  const [menuTarget, setMenuTarget] = useState<{ key: string; participantId: string; kind: TileKind; rect: AnchorRect } | null>(null);
  const menuOpenRef = useRef(false);

  const openTileMenu = useCallback((key: string, participantId: string, kind: TileKind, rect: AnchorRect) => {
    menuOpenRef.current = true;
    setMenuTarget({ key, participantId, kind, rect });
  }, []);
  const closeTileMenu = useCallback(() => {
    if (!menuOpenRef.current) return false;
    menuOpenRef.current = false;
    setMenuTarget(null);
    return true;
  }, []);

  return { menuTarget, openTileMenu, closeTileMenu };
}

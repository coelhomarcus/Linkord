export type TileKind = 'screen' | 'camera' | 'avatar';

export interface TileDescriptor {
  key: string;
  participantId: string;
  kind: TileKind;
  /** A publication exists and isn't muted, but its track hasn't attached
   * yet — a real, distinct state from "no camera"/"no share" that used to
   * be silently folded into `kind: 'avatar'` (or into not existing at all,
   * for screen). See useCallTiles.ts. */
  loading: boolean;
}

/** avatar and camera are the same participant tile, just with or without
 * video — the key must not change between them, or toggling the camera
 * remounts the tile and drops whatever held a reference to its old key
 * (focus, the DOM registry, an open menu). Screen is a genuinely different
 * tile. */
function identitySource(kind: TileKind): 'participant' | 'screen' {
  return kind === 'screen' ? 'screen' : 'participant';
}

export function tileKey(participantId: string, kind: TileKind): string {
  return `${participantId}:${identitySource(kind)}`;
}

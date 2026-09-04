/** A "tile" is now per media SOURCE, not per participant — someone sharing
 * screen and camera at once becomes two separate rectangles (Discord
 * style), not one overlapping the other. */
export type TileKind = 'screen' | 'camera' | 'avatar';

export interface TileDescriptor {
  /** `${participantId}:${kind}` — unique, used as the React key and as the
   * focus/menu target (lets you focus specifically someone's screen OR
   * camera). */
  key: string;
  participantId: string;
  kind: TileKind;
}

export function tileKey(participantId: string, kind: TileKind): string {
  return `${participantId}:${kind}`;
}

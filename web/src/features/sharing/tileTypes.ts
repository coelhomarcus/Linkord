export type TileKind = 'screen' | 'camera' | 'avatar';

export interface TileDescriptor {
  key: string;
  participantId: string;
  kind: TileKind;
}

export function tileKey(participantId: string, kind: TileKind): string {
  return `${participantId}:${kind}`;
}

// Where the reader was in each conversation, per surface (the main panel
// and the call panel scroll independently): the row at the top of the view
// and how far into it, or "at the present". A key, not a scrollTop — the
// rows above may have been measured differently by the time it's restored.

export interface ReadingPosition {
  key: string;
  /** scrollTop minus that row's start */
  offset: number;
  atEnd: boolean;
}

const MAX_POSITIONS = 50;
const positions = new Map<string, ReadingPosition>();

const slot = (surfaceId: string, conversationId: string) => `${surfaceId}\u0000${conversationId}`;

export function saveReadingPosition(surfaceId: string, conversationId: string, position: ReadingPosition): void {
  const key = slot(surfaceId, conversationId);
  positions.delete(key);
  positions.set(key, position);
  if (positions.size > MAX_POSITIONS) positions.delete(positions.keys().next().value!);
}

export function readingPositionFor(surfaceId: string, conversationId: string): ReadingPosition | undefined {
  return positions.get(slot(surfaceId, conversationId));
}

/** Test-only. */
export function __resetReadingPositionsForTests(): void {
  positions.clear();
}

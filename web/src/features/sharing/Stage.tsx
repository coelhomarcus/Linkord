import { useRoom } from '../../state/RoomContext';
import { useCallTiles } from './useCallTiles';
import { TileGrid } from './TileGrid';

/** A pair of tiles per participant, sharing or not — like Discord/Google
 * Meet's expanded view. A participant's screen and camera become separate
 * rectangles (see useCallTiles); anyone with neither just shows avatar+name
 * (kind 'avatar', see Tile.tsx). The self-adjusting grid (TileGrid) already
 * handles any number of tiles. <CallControlBar/> and
 * <ParticipantAudioLayer/> used to live here — moved up to the Shell
 * (App.tsx) along with `allIds` so controls and everyone else's audio keep
 * working while another channel's tab is active (see App.tsx). */
export function Stage({ allIds }: { allIds: string[] }) {
  const { state } = useRoom();
  const descriptors = useCallTiles(allIds);

  return (
    <main className="relative flex flex-1 min-w-0 items-center justify-center overflow-auto bg-bg-call p-5 pb-24 text-text-primary">
      <TileGrid descriptors={descriptors} focusedId={state.focusedId} />
    </main>
  );
}

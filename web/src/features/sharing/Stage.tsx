import { useRoom } from '../../state/RoomContext';
import { useCallTiles } from './useCallTiles';
import { TileGrid } from './TileGrid';

/** Um par de tiles por participante, compartilhando ou nao — igual a visao
 * expandida do Discord/Google Meet. Tela e camera do mesmo participante
 * viram retangulos separados (ver useCallTiles); quem nao tem nenhum dos
 * dois mostra so avatar+nome (kind 'avatar', ver Tile.tsx). O grid
 * auto-ajustavel (TileGrid) ja lida com qualquer quantidade de tiles.
 * <CallControlBar/> e <ParticipantAudioLayer/> moraram aqui antes — subiram
 * pro Shell (App.tsx) junto com `allIds` pra continuar funcionando (controles
 * e audio dos outros) quando a view "quadro" esta ativa (ver App.tsx). */
export function Stage({ allIds }: { allIds: string[] }) {
  const { state } = useRoom();
  const descriptors = useCallTiles(allIds);

  return (
    <main className="relative flex flex-1 min-w-0 items-center justify-center overflow-auto bg-bg-call p-5 pb-24 text-text-primary">
      <TileGrid descriptors={descriptors} focusedId={state.focusedId} />
    </main>
  );
}

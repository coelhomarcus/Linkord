import { ArrowLeft, Headphones, LoaderCircle, RotateCcw, TriangleAlert } from 'lucide-react';
import { useRoom } from '../../state/RoomContext';
import { useCallTiles } from './useCallTiles';
import { TileGrid } from './TileGrid';
import { Button } from '@/components/ui/button';

interface StageProps {
  allIds: string[];
  /** Below md, a floating back button returns to the channel list — Stage
   * itself has no header to put one in (full-bleed video grid). Irrelevant
   * from md up, where the sidebar is always visible. */
  onBackMobile: () => void;
  /** Returns to chat after cancelling/abandoning a voice entry attempt. */
  onExitVoice: () => void;
}

/** A pair of tiles per participant, sharing or not — like Discord/Google
 * Meet's expanded view. A participant's screen and camera become separate
 * rectangles (see useCallTiles); anyone with neither just shows avatar+name
 * (kind 'avatar', see Tile.tsx). The self-adjusting grid (TileGrid) already
 * handles any number of tiles. <CallControlBar/> and
 * <ParticipantAudioLayer/> used to live here — moved up to the Shell
 * (App.tsx) along with `allIds` so controls and everyone else's audio keep
 * working while another channel's tab is active (see App.tsx). */
export function Stage({ allIds, onBackMobile, onExitVoice }: StageProps) {
  const { state, categories, voiceConnection, retryVoiceChannel, cancelVoiceJoin } = useRoom();
  const descriptors = useCallTiles(allIds);
  const channelName = categories
    .flatMap((category) => category.channels)
    .find((channel) => channel.id === voiceConnection.channelId)?.name ?? 'canal de voz';

  async function handleCancel() {
    await cancelVoiceJoin();
    onExitVoice();
  }

  return (
    <main className="relative flex flex-1 min-w-0 items-center justify-center overflow-auto bg-bg-call p-2 pb-24 text-text-primary md:p-5">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Voltar pros canais"
        onClick={onBackMobile}
        className="absolute left-2 top-2 z-20 bg-bg-tertiary/80 text-text-secondary hover:bg-bg-hover md:hidden"
      >
        <ArrowLeft size={18} />
      </Button>
      {voiceConnection.status === 'connected' && (
        <TileGrid descriptors={descriptors} focusedId={state.focusedId} />
      )}

      {voiceConnection.status === 'joining' && (
        <section
          role="status"
          aria-live="polite"
          aria-busy="true"
          className="flex max-w-md flex-col items-center gap-4 rounded-xl border border-strong bg-bg-panel p-8 text-center shadow-panel"
        >
          <LoaderCircle className="size-8 animate-spin text-blurple" aria-hidden="true" />
          <div className="flex flex-col gap-1">
            <h1 className="text-title font-semibold">Entrando em {channelName}</h1>
            <p className="text-label text-text-secondary">
              Conectando ao servidor de voz{voiceConnection.mode === 'listen-only' ? ' no modo somente ouvir' : ''}.
            </p>
          </div>
          <Button type="button" variant="outline" onClick={() => void handleCancel()}>
            Cancelar
          </Button>
        </section>
      )}

      {voiceConnection.status === 'failed' && (
        <section
          role="alert"
          className="flex max-w-md flex-col items-center gap-4 rounded-xl border border-strong bg-bg-panel p-8 text-center shadow-panel"
        >
          <TriangleAlert className="size-8 text-red" aria-hidden="true" />
          <div className="flex flex-col gap-1">
            <h1 className="text-title font-semibold">Nao foi possivel entrar em {channelName}</h1>
            <p className="text-label text-text-secondary">
              {voiceConnection.error ?? 'Verifique sua conexao e tente novamente.'}
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            <Button type="button" onClick={retryVoiceChannel}>
              <RotateCcw data-icon="inline-start" />
              Tentar novamente
            </Button>
            <Button type="button" variant="outline" onClick={() => void handleCancel()}>
              Cancelar
            </Button>
          </div>
        </section>
      )}

      {voiceConnection.status === 'idle' && (
        <section className="flex max-w-md flex-col items-center gap-4 text-center">
          <Headphones className="size-9 text-text-muted" aria-hidden="true" />
          <div className="flex flex-col gap-1">
            <h1 className="text-title font-semibold">Nenhuma chamada ativa</h1>
            <p className="text-label text-text-secondary">Escolha um canal de voz na barra lateral para entrar.</p>
          </div>
          <Button type="button" variant="outline" onClick={onExitVoice}>Voltar ao chat</Button>
        </section>
      )}
    </main>
  );
}

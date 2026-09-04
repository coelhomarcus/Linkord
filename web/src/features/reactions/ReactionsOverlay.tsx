import { useRoom } from '../../state/RoomContext';

/** Camada flutuante de reacoes-relampago sobre o palco — cada uma nasce numa
 * posicao horizontal sorteada (RoomProvider) e sobe sozinha via CSS; aqui e
 * so exibicao. Estilo Google Meet: emoji grande, quase sem moldura, nome
 * pequeno e discreto embaixo. */
export function ReactionsOverlay() {
  const { state, reactions } = useRoom();

  if (!reactions.length) return null;

  return (
    // z-40: acima da barra de controles da chamada (z-20) e do PiP flutuante
    // (z-30) — igual o Google Meet, a reacao passa por cima de tudo na tela
    // de call. Fica abaixo de modal/dropdown/menu (z-50) e do aviso de
    // reconexao (z-[60]) de proposito, esses continuam por cima.
    <div className="pointer-events-none absolute inset-0 z-40 overflow-hidden">
      {reactions.map((r) => {
        const name = r.id === state.me.id ? state.me.name : (state.participants.get(r.id)?.name ?? '');
        return (
          <div
            key={r.key}
            className="animate-float-up absolute bottom-4 flex -translate-x-1/2 select-none flex-col items-center gap-0.5"
            style={{ left: `${r.left}%` }}
          >
            <span className="text-5xl leading-none drop-shadow-[0_2px_6px_rgba(0,0,0,0.45)]">{r.emoji}</span>
            {name && <span className="max-w-24 truncate text-caption font-medium text-text-primary/80 drop-shadow-sm">{name}</span>}
          </div>
        );
      })}
    </div>
  );
}

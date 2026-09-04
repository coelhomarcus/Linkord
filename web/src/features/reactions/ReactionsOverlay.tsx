import { useRoom } from '../../state/RoomContext';

/** Floating layer of flash reactions over the stage — each one spawns at a
 * random horizontal position (RoomProvider) and floats up on its own via
 * CSS; this is just display. Google Meet style: big emoji, almost no
 * frame, small discreet name below. */
export function ReactionsOverlay() {
  const { state, reactions } = useRoom();

  if (!reactions.length) return null;

  return (
    // z-40: above the call control bar (z-20) and the floating PiP (z-30)
    // — like Google Meet, reactions render over everything on the call
    // screen. Stays below modal/dropdown/menu (z-50) and the reconnect
    // banner (z-[60]) on purpose — those stay on top.
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

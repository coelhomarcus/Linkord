import { useRoom } from '../../state/RoomContext';

export function ReactionsOverlay() {
  const { state, reactions } = useRoom();

  if (!reactions.length) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-40 overflow-hidden">
      {reactions.map((r) => {
        const name = r.id === state.me.id ? state.me.displayName : (state.participants.get(r.id)?.displayName ?? '');
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

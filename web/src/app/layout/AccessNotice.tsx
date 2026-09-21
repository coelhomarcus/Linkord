import { useEffect } from 'react';
import { UserX, X } from 'lucide-react';
import { useRoom } from '@/state/RoomContext';

const DISMISS_AFTER_MS = 10_000;

export function AccessNotice() {
  const { accessNotice, clearAccessNotice } = useRoom();

  useEffect(() => {
    if (!accessNotice) return;
    const timer = setTimeout(clearAccessNotice, DISMISS_AFTER_MS);
    return () => clearTimeout(timer);
  }, [accessNotice, clearAccessNotice]);

  if (!accessNotice) return null;
  return (
    <div role="status" className="fixed left-1/2 top-4 z-60 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-2 rounded-full border border-strong bg-bg-floating/90 py-2 pl-3.5 pr-2 text-label font-medium text-text-primary shadow-popover backdrop-blur-xl">
      <UserX size={15} className="flex-none text-red-text" />
      <span className="min-w-0 truncate">{accessNotice}</span>
      <button type="button" aria-label="Dispensar aviso" onClick={clearAccessNotice} className="grid size-6 flex-none place-items-center rounded-full text-text-muted hover:bg-white/10 hover:text-text-primary">
        <X size={13} />
      </button>
    </div>
  );
}

import { useEffect } from 'react';
import { UserX } from 'lucide-react';
import { CloseButton } from '@/shared/ui/primitives/close-button';
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
      <CloseButton size="xs" label="Dispensar aviso" onClick={clearAccessNotice} />
    </div>
  );
}

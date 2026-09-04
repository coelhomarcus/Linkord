import { useRoom } from '../state/RoomContext';

export function ReconnectBanner() {
  const { state } = useRoom();
  if (!state.reconnecting) return null;
  return (
    <div className="fixed inset-x-0 top-0 z-[60] select-none bg-red px-3 py-2.5 text-center text-body font-semibold text-white">
      Conexao com o servidor caiu. Reconectando...
    </div>
  );
}

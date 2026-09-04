import { ErrorBanner } from '../../shared/ErrorBanner';
import { Button } from '@/components/ui/button';

/** Fullscreen view for errors that prevent being in the room (today: room
 * full) — the socket has already been deliberately disconnected at this
 * point (see RoomProvider), so there's nothing behind it to show. "Try
 * again" just reloads — simpler than manually reconnecting the socket, and
 * covers the common case (the room emptied out in the meantime). */
export function RoomErrorScreen({ message }: { message: string }) {
  return (
    <div className="flex h-dvh items-center justify-center bg-bg-primary p-4">
      <div className="flex w-full max-w-100 flex-col gap-3.5 rounded-xl bg-bg-floating p-6">
        <h1 className="text-display font-bold text-text-primary">Nao foi possivel entrar</h1>
        <ErrorBanner>{message}</ErrorBanner>
        <Button type="button" size="lg" onClick={() => location.reload()}>Tentar de novo</Button>
      </div>
    </div>
  );
}

import { ErrorBanner } from '../../shared/ErrorBanner';
import { Button } from '@/components/ui/button';

/** Tela cheia pra erros que impedem estar na sala (hoje: sala cheia) — o
 * socket ja foi desconectado de proposito nesse ponto (ver RoomProvider),
 * entao nao ha nada por tras pra mostrar. "Tentar de novo" so recarrega —
 * mais simples que reconectar o socket manualmente, e cobre o caso comum
 * (a sala esvaziou enquanto isso). */
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

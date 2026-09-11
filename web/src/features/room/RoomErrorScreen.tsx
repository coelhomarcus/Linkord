import { ErrorBanner } from '../../shared/ErrorBanner';
import { Button } from '@/components/ui/button';

export function RoomErrorScreen({ message }: { message: string }) {
  return (
    <div className="flex h-dvh items-center justify-center bg-bg-primary p-4">
      <div className="flex w-full max-w-100 flex-col gap-3.5 rounded-xl bg-bg-floating p-6">
        <h1 className="text-display font-bold text-text-primary">Não foi possível entrar</h1>
        <ErrorBanner>{message}</ErrorBanner>
        <Button type="button" size="lg" onClick={() => location.reload()}>Tentar de novo</Button>
      </div>
    </div>
  );
}

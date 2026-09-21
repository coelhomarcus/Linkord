import { Button } from '@/shared/ui/primitives/button';

/** Shown when the server refuses this build's protocol (`client_outdated`).
 * Nothing else can work until the page is reloaded onto the new build, and
 * retrying the connection would only get the same answer. */
export function OutdatedClientScreen() {
  return (
    <div className="flex h-dvh items-center justify-center bg-bg-primary p-4">
      <div role="alert" className="flex w-full max-w-100 flex-col gap-3.5 rounded-xl bg-bg-floating p-6">
        <h1 className="text-display font-bold text-text-primary">Há uma versão nova do Linkord</h1>
        <p className="text-body text-text-secondary">
          O Linkord foi atualizado e esta aba ainda está na versão anterior. Atualize a página para continuar — suas conversas e amizades continuam como estavam.
        </p>
        <Button type="button" size="lg" onClick={() => location.reload()}>Atualizar a página</Button>
      </div>
    </div>
  );
}

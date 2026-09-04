/** Tela cheia mostrada enquanto ainda nao ha nada de verdade pra ver — ou
 * checando sessao (AuthGate) ou conectada mas esperando o `welcome` do
 * servidor (Shell, antes de state.joined). Sem isso, a pagina piscava um
 * "esqueleto" da UI vazio (sidebar sem canais, chat sem mensagens) por um
 * instante ate os dados chegarem, o que parecia o site "montando" errado.
 * A barra usa --animate-sweep (index.css) — ja existia, definida mas sem
 * nenhum uso ainda. */
export function LoadingScreen() {
  return (
    <div className="flex h-dvh items-center justify-center bg-bg-primary">
      <div className="flex flex-col items-center gap-4">
        <div className="flex items-center gap-2 select-none">
          <img src="/logo.svg" alt="" className="h-8 w-8 flex-none" />
          <span className="text-display font-bold tracking-tight text-text-primary">Linkord</span>
        </div>
        <div className="relative h-1 w-40 overflow-hidden rounded-full bg-bg-secondary">
          <div className="animate-sweep absolute inset-y-0 w-1/3 rounded-full bg-blurple" />
        </div>
      </div>
    </div>
  );
}

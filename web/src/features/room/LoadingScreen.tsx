export function LoadingScreen() {
  return (
    <div className="flex h-dvh items-center justify-center bg-bg-primary">
      <div className="flex flex-col items-center gap-4">
        <div className="flex items-center gap-2 select-none">
          <img src="/logo.svg" alt="" className="h-8 w-8 flex-none" />
          <span className="text-display font-bold tracking-tight text-text-primary">Linkord</span>
        </div>
        <div className="relative h-1 w-40 overflow-hidden rounded-full bg-bg-secondary">
          <div className="animate-sweep absolute inset-y-0 w-1/3 rounded-full bg-primary" />
        </div>
      </div>
    </div>
  );
}

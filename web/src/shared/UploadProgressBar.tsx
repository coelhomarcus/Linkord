/** Thin progress bar — real upload feedback (0 to 1), instead of a static
 * "Uploading…" text with no sense of how much is left. */
export function UploadProgressBar({ progress }: { progress: number }) {
  const pct = Math.round(Math.min(1, Math.max(0, progress)) * 100);
  return (
    <div
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      className="h-1 w-full overflow-hidden rounded-full bg-bg-tertiary"
    >
      <div className="h-full rounded-full bg-blurple transition-[width] duration-150 ease-out" style={{ width: `${pct}%` }} />
    </div>
  );
}

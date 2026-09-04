/** Whole MB — used in limit messages (e.g. "max 12MB"), where the cap
 * itself is already a round number of MB. */
export function formatMB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(0)}MB`;
}

/** Like formatMB, but for large caps (>= 1GB) where "2048MB" gets
 * unreadable — used by the chat attachment cap (2GB). */
export function formatSizeLimit(bytes: number): string {
  return bytes >= 1024 * 1024 * 1024 ? `${(bytes / (1024 * 1024 * 1024)).toFixed(0)}GB` : formatMB(bytes);
}

/** A specific file's size, with whatever unit fits best (B/KB/MB) —
 * unlike formatMB, which only works for already-round caps. */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

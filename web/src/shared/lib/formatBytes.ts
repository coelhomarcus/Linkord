/** MB inteiro — usado em mensagens de limite (ex.: "maximo 12MB"), onde o
 * teto em si ja e um numero redondo de MB. */
export function formatMB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(0)}MB`;
}

/** Como formatMB, mas pra tetos grandes (>= 1GB) onde "2048MB" fica
 * ilegivel — usado pelo teto de anexo de chat (2GB). */
export function formatSizeLimit(bytes: number): string {
  return bytes >= 1024 * 1024 * 1024 ? `${(bytes / (1024 * 1024 * 1024)).toFixed(0)}GB` : formatMB(bytes);
}

/** Tamanho de um arquivo especifico, com a unidade que melhor cabe
 * (B/KB/MB) — diferente de formatMB, que so serve pra tetos ja redondos. */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

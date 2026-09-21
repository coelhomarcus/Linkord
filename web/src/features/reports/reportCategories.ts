export const REPORT_CATEGORIES = [
  { value: 'spam', label: 'Spam ou propaganda' },
  { value: 'harassment', label: 'Assédio ou ameaça' },
  { value: 'inappropriate', label: 'Conteúdo impróprio' },
  { value: 'impersonation', label: 'Falsa identidade' },
  { value: 'illegal', label: 'Atividade ilegal' },
  { value: 'other', label: 'Outro motivo' },
] as const;

export type ReportCategory = (typeof REPORT_CATEGORIES)[number]['value'];
export type ReportTarget = { type: 'user' | 'group' | 'message'; id: string; label: string };

export const MAX_REPORT_DETAILS = 1000;

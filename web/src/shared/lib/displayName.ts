export const MAX_DISPLAY_NAME_LEN = 32;

export function sanitizeDisplayName(value: string): string {
  return value.replace(/[\r\n\t]+/g, ' ').trim().slice(0, MAX_DISPLAY_NAME_LEN);
}

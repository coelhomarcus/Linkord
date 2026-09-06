// same cap as the server (see server/src/config/env.ts#MAX_DISPLAY_NAME_LEN)
// — free-form, non-unique, no charset restriction (unlike username).
export const MAX_DISPLAY_NAME_LEN = 32;

/** Trims/collapses/caps only — falling back to the username when this comes
 * out empty is the CALLER's job (only it knows the account's username). */
export function sanitizeDisplayName(value: string): string {
  return value.replace(/[\r\n\t]+/g, ' ').trim().slice(0, MAX_DISPLAY_NAME_LEN);
}

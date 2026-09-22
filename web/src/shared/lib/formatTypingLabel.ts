// Caps at naming 3 people (matches the avatar stack in TypingIndicator.tsx,
// same rolling-name threshold Discord/Fluxer use) — beyond that a growing
// list of names reads worse than a plain count, so it falls back to a
// generic line instead of "Fulano e mais 7 estão digitando...".
const MAX_NAMED = 3;

/** "Fulano está digitando...", "Fulano e Beltrana estão digitando...",
 * "Fulano, Beltrana e Ciclano estão digitando...", or, beyond 3 people,
 * "Várias pessoas estão digitando...". */
export function formatTypingLabel(names: string[]): string | null {
  if (names.length === 0) return null;
  if (names.length === 1) return `${names[0]} está digitando...`;
  if (names.length === 2) return `${names[0]} e ${names[1]} estão digitando...`;
  if (names.length <= MAX_NAMED) return `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]} estão digitando...`;
  return 'Várias pessoas estão digitando...';
}

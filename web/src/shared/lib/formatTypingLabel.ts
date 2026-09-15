/** "Fulano está digitando...", "Fulano e Beltrana estão digitando...",
 * "Fulano e mais 2 estão digitando..." — shared between ConversationSidebar
 * and ConversationPanel so the pluralization rule lives in one place. */
export function formatTypingLabel(names: string[]): string | null {
  if (names.length === 0) return null;
  if (names.length === 1) return `${names[0]} está digitando...`;
  if (names.length === 2) return `${names[0]} e ${names[1]} estão digitando...`;
  return `${names[0]} e mais ${names.length - 1} estão digitando...`;
}

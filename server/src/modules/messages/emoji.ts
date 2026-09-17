import emojiRegex from 'emoji-regex';

const MAX_EMOJI_LENGTH = 16;

/** True when `value` is exactly one emoji (covers ZWJ sequences, skin tone
 * modifiers, flags, keycaps) and nothing else — guards the reaction endpoint
 * against arbitrary text while allowing any emoji, not just a fixed set. */
export function isSingleEmoji(value: string): boolean {
  if (!value || value.length > MAX_EMOJI_LENGTH) return false;
  const matches = value.match(emojiRegex());
  return matches !== null && matches.length === 1 && matches[0] === value;
}

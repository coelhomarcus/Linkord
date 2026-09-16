const graphemeSegmenter = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
  ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  : null;

const KEYCAP_RE = /^[0-9#*]\uFE0F?\u20E3$/u;
const EMOJI_PRESENTATION_RE = /\p{Emoji_Presentation}/u;
const EXTENDED_PICTOGRAPHIC_RE = /\p{Extended_Pictographic}/u;
const EMOJI_MODIFIER_RE = /^\p{Emoji_Modifier}$/u;

function isEmojiGrapheme(grapheme: string): boolean {
  if (EMOJI_MODIFIER_RE.test(grapheme)) return false;
  if (KEYCAP_RE.test(grapheme)) return true;
  if (EMOJI_PRESENTATION_RE.test(grapheme)) return true;

  // Text-default pictographs such as © and ™ only count when the message
  // explicitly asks for their emoji presentation with variation selector 16.
  return EXTENDED_PICTOGRAPHIC_RE.test(grapheme) && grapheme.includes('\uFE0F');
}

export function isSingleEmoji(text: string): boolean {
  const normalized = text.trim();
  if (!normalized || !graphemeSegmenter) return false;

  const graphemes = Array.from(graphemeSegmenter.segment(normalized), ({ segment }) => segment);
  return graphemes.length === 1 && isEmojiGrapheme(graphemes[0]);
}

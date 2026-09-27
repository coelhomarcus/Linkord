// The small formatting language of chat messages — a Discord-like subset, not
// full Markdown: no headings, tables, images or raw HTML, so an old message
// that happened to start with "#" keeps reading as it was written. One parser
// feeds both rendering and link previews, so a URL or @name inside code is
// never linked, mentioned or previewed.

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'code'; text: string }
  | { type: 'link'; url: string; suppressed: boolean }
  | { type: 'mention'; name: string }
  | { type: 'bold' | 'italic' | 'strike'; children: Inline[] };

export type Block =
  | { type: 'paragraph'; children: Inline[] }
  | { type: 'code'; lang: string | null; code: string }
  | { type: 'quote'; children: Inline[] }
  | { type: 'list'; ordered: boolean; items: Inline[][] };

// Order is priority at the same position: code first (nothing inside it is
// special), then links (so "_" or "*" in a URL stay literal), then mentions
// and the emphasis marks.
const INLINE_RE = new RegExp([
  '`([^`\\n]+)`',
  '<(https?:\\/\\/[^\\s<>]+)>',
  '(https?:\\/\\/[^\\s<>"\']+)',
  // "@" only starts a mention at the start of a word: never inside an e-mail
  '(?<![\\w@.])@([A-Za-z0-9_.-]{1,20})',
  '\\*\\*(.+?)\\*\\*',
  '~~(.+?)~~',
  '\\*([^*\\s](?:[^*]*?[^*\\s])?)\\*',
  '(?<![A-Za-z0-9_])_([^_\\s](?:[^_]*?[^_\\s])?)_(?![A-Za-z0-9_])',
].join('|'), 'gs');

const TRAILING_PUNCTUATION = /[.,;:!?'"]$/;

/** A URL typed at the end of a sentence shouldn't swallow the period, nor a
 * closing parenthesis that belongs to the text rather than the address. */
export function trimUrl(url: string): string {
  let out = url;
  for (;;) {
    if (TRAILING_PUNCTUATION.test(out)) { out = out.slice(0, -1); continue; }
    if (out.endsWith(')') && (out.match(/\(/g)?.length ?? 0) < (out.match(/\)/g)?.length ?? 0)) { out = out.slice(0, -1); continue; }
    return out;
  }
}

function pushText(nodes: Inline[], text: string) {
  if (!text) return;
  const last = nodes[nodes.length - 1];
  if (last?.type === 'text') last.text += text; else nodes.push({ type: 'text', text });
}

export function parseInline(text: string): Inline[] {
  const nodes: Inline[] = [];
  let lastIndex = 0;
  // a fresh instance per call: nested emphasis recurses, and a shared global
  // regex would lose its place in the outer text
  const re = new RegExp(INLINE_RE);
  for (let match = re.exec(text); match; match = re.exec(text)) {
    const [full, code, suppressed, url, mention, bold, strike, starItalic, underItalic] = match;
    pushText(nodes, text.slice(lastIndex, match.index));
    lastIndex = match.index + full.length;
    if (code !== undefined) nodes.push({ type: 'code', text: code });
    else if (suppressed !== undefined) nodes.push({ type: 'link', url: suppressed, suppressed: true });
    else if (url !== undefined) {
      const trimmed = trimUrl(url);
      nodes.push({ type: 'link', url: trimmed, suppressed: false });
      // give the trimmed tail back to the text
      lastIndex = match.index + trimmed.length;
      re.lastIndex = lastIndex;
    } else if (mention !== undefined) {
      const name = mention.replace(/\.+$/, '');
      nodes.push({ type: 'mention', name });
      lastIndex = match.index + 1 + name.length;
      re.lastIndex = lastIndex;
    } else if (bold !== undefined) nodes.push({ type: 'bold', children: parseInline(bold) });
    else if (strike !== undefined) nodes.push({ type: 'strike', children: parseInline(strike) });
    else nodes.push({ type: 'italic', children: parseInline((starItalic ?? underItalic)!) });
  }
  pushText(nodes, text.slice(lastIndex));
  return nodes;
}

const FENCE_RE = /^```([A-Za-z0-9_+#-]*)\s*$/;
const QUOTE_RE = /^> ?(.*)$/;
const BULLET_RE = /^\s*[-*] +(.*)$/;
const ORDERED_RE = /^\s*\d{1,3}[.)] +(.*)$/;

export function parseMessage(text: string): Block[] {
  const lines = text.split('\n');
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    const joined = paragraph.join('\n');
    if (joined.trim()) blocks.push({ type: 'paragraph', children: parseInline(joined) });
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const fence = FENCE_RE.exec(line.trim());
    if (fence) {
      const end = lines.findIndex((l, j) => j > i && l.trim() === '```');
      // an unclosed fence is just text: better than swallowing the rest
      if (end !== -1) {
        flush();
        blocks.push({ type: 'code', lang: fence[1] ? fence[1].toLowerCase() : null, code: lines.slice(i + 1, end).join('\n') });
        i = end;
        continue;
      }
    }
    // inline fence on one line: ```code```
    const oneLine = /^```([^`]+)```$/.exec(line.trim());
    if (oneLine) {
      flush();
      blocks.push({ type: 'code', lang: null, code: oneLine[1]! });
      continue;
    }
    if (QUOTE_RE.test(line) && line.startsWith('>')) {
      flush();
      const quoted: string[] = [];
      while (i < lines.length && lines[i]!.startsWith('>')) { quoted.push(QUOTE_RE.exec(lines[i]!)![1]!); i++; }
      i--;
      blocks.push({ type: 'quote', children: parseInline(quoted.join('\n')) });
      continue;
    }
    const listRe = BULLET_RE.test(line) ? BULLET_RE : ORDERED_RE.test(line) ? ORDERED_RE : null;
    if (listRe) {
      flush();
      const items: Inline[][] = [];
      while (i < lines.length && listRe.test(lines[i]!)) { items.push(parseInline(listRe.exec(lines[i]!)![1]!)); i++; }
      i--;
      blocks.push({ type: 'list', ordered: listRe === ORDERED_RE, items });
      continue;
    }
    paragraph.push(line);
  }
  flush();
  return blocks;
}

function collectInline(nodes: Inline[], out: string[]) {
  for (const node of nodes) {
    if (node.type === 'link' && !node.suppressed) out.push(node.url);
    else if (node.type === 'bold' || node.type === 'italic' || node.type === 'strike') collectInline(node.children, out);
  }
}

export const MAX_PREVIEWS = 3;

/** Links worth a preview: outside code, not wrapped in <…>, each address
 * once (query strings included — they often are the content), at most three
 * so a pasted list of links doesn't fire a request per line. */
export function previewableLinks(blocks: Block[]): string[] {
  const urls: string[] = [];
  for (const block of blocks) {
    if (block.type === 'paragraph' || block.type === 'quote') collectInline(block.children, urls);
    else if (block.type === 'list') block.items.forEach((item) => collectInline(item, urls));
  }
  return [...new Set(urls)].slice(0, MAX_PREVIEWS);
}

import type { Highlighter } from 'shiki';

const THEME = 'github-dark';

// shiki itself is only pulled in on first use (dynamic import), and each
// language grammar is loaded on demand — a code preview for one language
// never drags in every other language's grammar/highlighter machinery into
// the main bundle.
let highlighterPromise: Promise<Highlighter> | null = null;
const loadedLangs = new Set<string>();

async function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = import('shiki').then(({ createHighlighter }) => (
      createHighlighter({ themes: [THEME], langs: [] })
    ));
  }
  return highlighterPromise;
}

/** Renders `code` to a self-contained, already-escaped HTML string (shiki
 * escapes the source text itself — only its own fixed <pre>/<code>/<span>
 * markup wraps it), or null when the language isn't recognized/supported
 * so the caller can fall back to a plain <pre>. Never throws. */
export async function highlightCode(code: string, language: string | null): Promise<string | null> {
  if (!language || language === 'text') return null;
  try {
    const highlighter = await getHighlighter();
    if (!loadedLangs.has(language)) {
      await highlighter.loadLanguage(language as Parameters<Highlighter['loadLanguage']>[0]);
      loadedLangs.add(language);
    }
    return highlighter.codeToHtml(code, { lang: language, theme: THEME });
  } catch {
    return null;
  }
}

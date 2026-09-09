import type { ReactNode } from 'react';

// Private-Use-Area markers the server asks Postgres ts_headline() to wrap
// matches in, instead of real HTML tags (see server/src/modules/chat.ts#
// handleMessageSearch) — never typed in real chat text, so splitting on
// them can't misfire on user content.
const START = '';
const STOP = '';

/** Splits a search-result snippet into plain-text/highlighted React nodes —
 * mirrors ChatMessageText.tsx's own "tokenize by hand, never build/parse an
 * HTML string" convention (no dangerouslySetInnerHTML). A snippet can
 * contain more than one highlighted run (ts_headline can mark several
 * matched words within its one fragment). */
export function renderSearchSnippet(snippet: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const parts = snippet.split(START);
  if (parts[0]) nodes.push(parts[0]);
  for (let i = 1; i < parts.length; i++) {
    const [highlighted, rest] = parts[i]!.split(STOP);
    if (highlighted) {
      nodes.push(<mark key={i} className="rounded-sm bg-yellow/30 text-text-primary">{highlighted}</mark>);
    }
    if (rest) nodes.push(rest);
  }
  return nodes;
}

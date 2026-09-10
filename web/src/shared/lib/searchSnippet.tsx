import type { ReactNode } from 'react';

const START = '';
const STOP = '';

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

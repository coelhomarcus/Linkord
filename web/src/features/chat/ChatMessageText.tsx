import type { ReactNode } from 'react';
import { firstEmbed } from '../../shared/lib/chatEmbeds';
import { ChatEmbed } from './ChatEmbed';
import type { PublicUser } from '../../types/protocol';
import { cn } from '@/shared/lib/utils';

// URL and @mention share one pass so a mention regex never re-matches
// inside an already-consumed URL span (e.g. a query string with "@").
const TOKEN_RE = /(https?:\/\/[^\s<>"']+)|@([A-Za-z0-9_.-]{1,20})/g;

/** `mentionLookup` is optional (and keyed by LOWERCASE username, see
 * shared/lib/mentions.ts#buildMentionLookup) — without it (or empty) every
 * "@word" just falls through as plain text below, same as before this
 * feature existed (also what the component's own tests rely on, see
 * ChatMessageText.test.tsx). Only a "@word" that resolves to a REAL
 * registered account becomes a mention — anything else (an email's domain,
 * a typo) renders as-is. */
function renderRich(text: string, mentionLookup: Map<string, PublicUser> | undefined, myUserId: string | null | undefined) {
  const nodes: (string | ReactNode)[] = [];
  let lastIndex = 0;
  let key = 0;
  for (const match of text.matchAll(TOKEN_RE)) {
    const index = match.index ?? 0;
    if (index > lastIndex) nodes.push(text.slice(lastIndex, index));
    lastIndex = index + match[0].length;
    const [full, url, mentionName] = match;
    if (url) {
      nodes.push(<a key={key++} href={url} target="_blank" rel="noopener noreferrer" className="break-all text-blurple hover:underline">{url}</a>);
      continue;
    }
    const user = mentionName ? mentionLookup?.get(mentionName.toLowerCase()) : undefined;
    if (!user) { nodes.push(full); continue; }
    const isMe = myUserId != null && user.id === myUserId;
    nodes.push(
      <span key={key++} className={cn('rounded px-1 font-medium', isMe ? 'bg-yellow/25 text-yellow' : 'bg-blurple/15 text-blurple')}>
        @{user.username}
      </span>
    );
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

interface ChatMessageTextProps {
  text: string;
  /** Lowercase username -> user (see shared/lib/mentions.ts#buildMentionLookup)
   * — omitted, "@word" never highlights (used by callers that don't need it,
   * e.g. reply previews). */
  mentionLookup?: Map<string, PublicUser>;
  myUserId?: string | null;
}

export function ChatMessageText({ text, mentionLookup, myUserId }: ChatMessageTextProps) {
  const embed = firstEmbed(text);
  // the link that became an embed disappears from the text — only the
  // player/preview remains, not the raw link above it. If the message was
  // just the link, no paragraph is left.
  const remaining = embed ? text.replace(embed.url, '').replace(/[ \t]{2,}/g, ' ').trim() : text;
  return (
    <>
      {remaining && <p className="whitespace-pre-wrap wrap-break-word">{renderRich(remaining, mentionLookup, myUserId)}</p>}
      {embed && <ChatEmbed embed={embed} />}
    </>
  );
}

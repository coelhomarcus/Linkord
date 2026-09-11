import type { ReactNode } from 'react';
import { firstEmbed } from '../../shared/lib/chatEmbeds';
import { ChatEmbed } from './ChatEmbed';
import type { PublicUser } from '../../types/protocol';
import { cn } from '@/shared/lib/utils';

const TOKEN_RE = /(https?:\/\/[^\s<>"']+)|@([A-Za-z0-9_.-]{1,20})/g;

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
      nodes.push(<a key={key++} href={url} target="_blank" rel="noopener noreferrer" className="break-all text-primary hover:underline">{url}</a>);
      continue;
    }
    const user = mentionName ? mentionLookup?.get(mentionName.toLowerCase()) : undefined;
    if (!user) { nodes.push(full); continue; }
    const isMe = myUserId != null && user.id === myUserId;
    nodes.push(
      <span key={key++} className={cn('rounded px-1 font-medium', isMe ? 'bg-yellow/25 text-yellow' : 'bg-primary/15 text-primary')}>
        @{user.displayName}
      </span>
    );
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

interface ChatMessageTextProps {
  text: string;
  mentionLookup?: Map<string, PublicUser>;
  myUserId?: string | null;
  /** True when this message is nothing but the embed's own URL — drops the
   * embed's own top margin since there's no caption line above it. */
  edgeToEdge?: boolean;
}

export function ChatMessageText({ text, mentionLookup, myUserId, edgeToEdge }: ChatMessageTextProps) {
  const embed = firstEmbed(text);
  const remaining = embed && text.trim() === embed.url ? '' : text;
  return (
    <>
      {remaining && <p className="whitespace-pre-wrap wrap-break-word">{renderRich(remaining, mentionLookup, myUserId)}</p>}
      {embed && <ChatEmbed embed={embed} edgeToEdge={!remaining && edgeToEdge} />}
    </>
  );
}

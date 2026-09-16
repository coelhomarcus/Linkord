import type { ReactNode } from 'react';
import { firstEmbed } from '../../shared/lib/chatEmbeds';
import { ChatEmbed } from './ChatEmbed';
import type { PublicUser } from '../../types/protocol';
import { Avatar } from '@/shared/Avatar';
import { cn } from '@/shared/lib/utils';
import { isSingleEmoji } from '@/shared/lib/isSingleEmoji';

const TOKEN_RE = /(https?:\/\/[^\s<>"']+)|@([A-Za-z0-9_.-]{1,20})/g;

function renderRich(
  text: string,
  mentionLookup: Map<string, PublicUser> | undefined,
  myUserId: string | null | undefined,
  onOpenProfile: ((userId: string) => void) | undefined
) {
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
      <button
        key={key++}
        type="button"
        disabled={!onOpenProfile}
        onClick={() => onOpenProfile?.(user.id)}
        className={cn(
          'inline-flex translate-y-0.75 items-center gap-1 rounded px-1 py-0.5 align-middle font-medium',
          isMe ? 'bg-yellow/25 text-yellow' : 'bg-primary/15 text-primary',
          onOpenProfile && (isMe ? 'hover:bg-yellow/35' : 'hover:bg-primary/25')
        )}
      >
        <span>@{user.displayName}</span>
        <Avatar id={user.id} name={user.displayName} avatar={user.avatar} avatarColor={user.avatarColor} size={16} />
      </button>
    );
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

interface ChatMessageTextProps {
  text: string;
  mentionLookup?: Map<string, PublicUser>;
  myUserId?: string | null;
  /** Opens the mentioned user's profile modal when their @mention chip is
   * clicked — no-op (chip renders disabled) when not provided. */
  onOpenProfile?: (userId: string) => void;
  /** True when this message is nothing but the embed's own URL — drops the
   * embed's own top margin since there's no caption line above it. */
  edgeToEdge?: boolean;
}

export function ChatMessageText({ text, mentionLookup, myUserId, onOpenProfile, edgeToEdge }: ChatMessageTextProps) {
  const embed = firstEmbed(text);
  const remaining = embed && text.trim() === embed.url ? '' : text;
  const singleEmoji = isSingleEmoji(text);
  return (
    <>
      {remaining && (
        <p className={cn('whitespace-pre-wrap wrap-break-word', singleEmoji && 'text-[48px] leading-none')}>
          {renderRich(remaining, mentionLookup, myUserId, onOpenProfile)}
        </p>
      )}
      {embed && <ChatEmbed embed={embed} edgeToEdge={!remaining && edgeToEdge} />}
    </>
  );
}

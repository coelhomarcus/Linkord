import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { detectEmbed } from '@/shared/lib/chatEmbeds';
import { highlightCode } from '@/shared/lib/highlightCode';
import type { PublicUser } from '@/shared/types/protocol';
import { Avatar } from '@/shared/Avatar';
import { cn } from '@/shared/lib/utils';
import { isSingleEmoji } from '@/shared/lib/isSingleEmoji';
import { ChatEmbed } from './ChatEmbed';
import { parseMessage, previewableLinks, type Inline } from './messageMarkup';

interface RenderContext {
  mentionLookup?: Map<string, PublicUser>;
  myUserId?: string | null;
  onOpenProfile?: (userId: string) => void;
}

function Mention({ name, ctx }: { name: string; ctx: RenderContext }) {
  const user = ctx.mentionLookup?.get(name.toLowerCase());
  if (!user) return <>@{name}</>;
  const isMe = ctx.myUserId != null && user.id === ctx.myUserId;
  return (
    <button
      type="button"
      disabled={!ctx.onOpenProfile}
      onClick={() => ctx.onOpenProfile?.(user.id)}
      className={cn(
        // h-6 (24px) matches the surrounding text's own line box exactly
        // (text-body is 1rem/1.5 = 24px, set globally on html/body — see
        // index.css) — a content-driven height here (padding + the 16px
        // avatar) came out shorter than that, so the chip always sat a
        // few px off the text baseline no matter how align-middle/a
        // manual translate tried to compensate.
        'inline-flex h-6 items-center gap-1 rounded px-1 align-middle font-medium',
        isMe ? 'bg-yellow/25 text-yellow' : 'bg-primary/15 text-primary',
        ctx.onOpenProfile && (isMe ? 'hover:bg-yellow/35' : 'hover:bg-primary/25')
      )}
    >
      <span>@{user.displayName}</span>
      <Avatar id={user.id} name={user.displayName} avatar={user.avatar} avatarColor={user.avatarColor} size={16} />
    </button>
  );
}

function renderInline(nodes: Inline[], ctx: RenderContext): ReactNode[] {
  return nodes.map((node, index) => {
    switch (node.type) {
      case 'text': return node.text;
      case 'code': return <code key={index} className="rounded bg-white/10 px-1 py-0.5 font-mono text-[0.875em]">{node.text}</code>;
      case 'link': return <a key={index} href={node.url} target="_blank" rel="noopener noreferrer" className="break-all text-primary hover:underline">{node.url}</a>;
      case 'mention': return <Mention key={index} name={node.name} ctx={ctx} />;
      case 'bold': return <strong key={index} className="font-semibold text-text-primary">{renderInline(node.children, ctx)}</strong>;
      case 'italic': return <em key={index}>{renderInline(node.children, ctx)}</em>;
      case 'strike': return <s key={index}>{renderInline(node.children, ctx)}</s>;
    }
  });
}

// Highlighted HTML by language+source: remounting a row (switching
// conversations, scrolling back) must not run shiki again.
const highlightCache = new Map<string, string | null>();
const MAX_HIGHLIGHTS = 100;

function CodeBlock({ code, lang }: { code: string; lang: string | null }) {
  const cacheKey = `${lang}\u0000${code}`;
  const [html, setHtml] = useState<string | null>(() => highlightCache.get(cacheKey) ?? null);
  useEffect(() => {
    if (!lang || highlightCache.has(cacheKey)) return;
    let cancelled = false;
    // highlighting is decoration: the plain block is already readable, so a
    // big snippet never holds up typing or scrolling
    void highlightCode(code, lang).then((result) => {
      if (highlightCache.size >= MAX_HIGHLIGHTS) highlightCache.delete(highlightCache.keys().next().value!);
      highlightCache.set(cacheKey, result);
      if (!cancelled) setHtml(result);
    });
    return () => { cancelled = true; };
  }, [cacheKey, code, lang]);

  const frame = 'my-1 max-w-full overflow-x-auto rounded-md border border-white/10 bg-black/30 text-[0.875rem] leading-relaxed';
  // shiki escapes the source itself; only its own fixed markup wraps it
  if (html) return <div className={cn(frame, '[&_pre]:bg-transparent! [&_pre]:p-3')} dangerouslySetInnerHTML={{ __html: html }} />;
  return <pre className={cn(frame, 'p-3 font-mono')}><code>{code}</code></pre>;
}

interface ChatMessageTextProps {
  text: string;
  mentionLookup?: Map<string, PublicUser>;
  myUserId?: string | null;
  /** Opens the mentioned user's profile modal when their @mention chip is
   * clicked — no-op (chip renders disabled) when not provided. */
  onOpenProfile?: (userId: string) => void;
}

export function ChatMessageText({ text, mentionLookup, myUserId, onOpenProfile }: ChatMessageTextProps) {
  const blocks = useMemo(() => parseMessage(text), [text]);
  const embeds = useMemo(() => previewableLinks(blocks).flatMap((url) => detectEmbed(url) ?? []), [blocks]);
  const singleEmoji = isSingleEmoji(text);
  const ctx: RenderContext = { mentionLookup, myUserId, onOpenProfile };

  return (
    <>
      {blocks.map((block, index) => {
        switch (block.type) {
          case 'paragraph':
            return <p key={index} className={cn('whitespace-pre-wrap wrap-break-word', singleEmoji && 'text-[48px] leading-none')}>{renderInline(block.children, ctx)}</p>;
          case 'code':
            return <CodeBlock key={index} code={block.code} lang={block.lang} />;
          case 'quote':
            return <blockquote key={index} className="my-0.5 whitespace-pre-wrap wrap-break-word border-l-4 border-white/20 pl-3 text-text-muted">{renderInline(block.children, ctx)}</blockquote>;
          case 'list': {
            const List = block.ordered ? 'ol' : 'ul';
            return (
              <List key={index} className={cn('my-0.5 pl-6 wrap-break-word', block.ordered ? 'list-decimal' : 'list-disc')}>
                {block.items.map((item, i) => <li key={i}>{renderInline(item, ctx)}</li>)}
              </List>
            );
          }
        }
      })}
      {embeds.map((embed) => <ChatEmbed key={embed.url} embed={embed} />)}
    </>
  );
}

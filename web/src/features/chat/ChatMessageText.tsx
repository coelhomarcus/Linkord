import { firstEmbed } from '../../shared/lib/chatEmbeds';
import { ChatEmbed } from './ChatEmbed';

const LINK_SPLIT_RE = /(https?:\/\/[^\s<>"']+)/gi;

function linkify(text: string) {
  return text.split(LINK_SPLIT_RE).map((part, i) => (
    /^https?:\/\//i.test(part)
      ? <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="break-all text-blurple hover:underline">{part}</a>
      : part
  ));
}

export function ChatMessageText({ text }: { text: string }) {
  const embed = firstEmbed(text);
  // the link that became an embed disappears from the text — only the
  // player/preview remains, not the raw link above it. If the message was
  // just the link, no paragraph is left.
  const remaining = embed ? text.replace(embed.url, '').replace(/[ \t]{2,}/g, ' ').trim() : text;
  return (
    <>
      {remaining && <p className="whitespace-pre-wrap wrap-break-word">{linkify(remaining)}</p>}
      {embed && <ChatEmbed embed={embed} />}
    </>
  );
}

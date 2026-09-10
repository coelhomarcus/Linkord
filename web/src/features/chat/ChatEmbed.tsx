import { LinkPreview } from '../../shared/LinkPreview';
import type { DetectedEmbed } from '../../shared/lib/chatEmbeds';

export function ChatEmbed({ embed }: { embed: DetectedEmbed }) {
  return <LinkPreview embed={embed} className="mt-1.5" />;
}

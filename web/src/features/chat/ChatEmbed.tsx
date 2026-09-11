import { LinkPreview } from '../../shared/LinkPreview';
import type { DetectedEmbed } from '../../shared/lib/chatEmbeds';

export function ChatEmbed({ embed, edgeToEdge }: { embed: DetectedEmbed; edgeToEdge?: boolean }) {
  return <LinkPreview embed={embed} edgeToEdge={edgeToEdge} className={edgeToEdge ? undefined : 'mt-1.5'} />;
}

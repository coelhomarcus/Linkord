import { LinkPreview } from '../../shared/LinkPreview';
import type { DetectedEmbed } from '../../shared/lib/chatEmbeds';

/** Preview of a chat link — sits right under the text above (mt-1.5). The
 * actual rendering lives in LinkPreview. */
export function ChatEmbed({ embed }: { embed: DetectedEmbed }) {
  return <LinkPreview embed={embed} className="mt-1.5" />;
}

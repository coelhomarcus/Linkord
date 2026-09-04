import { LinkPreview } from '../../shared/LinkPreview';
import type { DetectedEmbed } from '../../shared/lib/chatEmbeds';

/** Preview de um link do chat — encosta no texto de cima (mt-1.5). A
 * renderizacao de verdade mora em LinkPreview (compartilhada com o modal
 * de preview de link do quadro). */
export function ChatEmbed({ embed }: { embed: DetectedEmbed }) {
  return <LinkPreview embed={embed} className="mt-1.5" />;
}

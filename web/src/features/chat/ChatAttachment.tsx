import { useState } from 'react';
import { File as FileIcon } from 'lucide-react';
import type { ChatAttachment as ChatAttachmentData } from '../../types/protocol';
import { ImageLightbox } from '../../shared/ImageLightbox';
import { formatFileSize } from '../../shared/lib/formatBytes';

// espelha INLINE_MIME_TYPES de server/attachments.js — so decide COMO
// renderizar aqui; o servidor decide de verdade como serve de volta
// (Content-Type/Content-Disposition), essa lista aqui e so pra UI.
const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const VIDEO_MIME_TYPES = new Set(['video/mp4', 'video/webm', 'video/ogg']);
const AUDIO_MIME_TYPES = new Set(['audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/mp4']);

/** Um anexo (imagem, video, audio ou qualquer outro arquivo) dentro de uma
 * mensagem. Imagem abre um modal em tela cheia ao clicar (ImageLightbox,
 * estilo Discord — nao mais uma aba nova); video/audio tocam inline;
 * qualquer outro tipo vira um chip com nome+tamanho que baixa ao clicar
 * (o servidor ja forca download via Content-Disposition nesse caso, ver
 * server/attachments.js#serveUpload).
 *
 * `target="_blank"` no chip de download NAO e cosmetico: sem ele, um clique
 * navega a PROPRIA aba pro link (mesmo com download forcado pelo servidor,
 * alguns navegadores ainda trocam de pagina primeiro) — isso desmonta o app
 * inteiro, derrubando a chamada em andamento junto. Com _blank, o pior caso
 * vira uma aba nova, nunca a nossa. */
export function ChatAttachment({ attachment }: { attachment: ChatAttachmentData }) {
  const url = `/uploads/${attachment.id}`;
  const [lightboxOpen, setLightboxOpen] = useState(false);

  if (IMAGE_MIME_TYPES.has(attachment.mime)) {
    return (
      <>
        <button type="button" onClick={() => setLightboxOpen(true)} className="mt-1.5 block w-fit cursor-zoom-in">
          <img
            src={url}
            alt={attachment.name}
            loading="lazy"
            // max-w fixo (nao so max-w-full): sem isso, uma imagem bem mais
            // larga que alta cresce ate a largura inteira da coluna do chat
            // pra caber no max-h — enorme mesmo sendo "so" uma miniatura.
            className="max-h-80 max-w-sm rounded-md border border-strong object-contain"
          />
        </button>
        <ImageLightbox src={url} alt={attachment.name} open={lightboxOpen} onOpenChange={setLightboxOpen} />
      </>
    );
  }

  if (VIDEO_MIME_TYPES.has(attachment.mime)) {
    return (
      // eslint-disable-next-line jsx-a11y/media-has-caption
      <video src={url} controls preload="metadata" className="mt-1.5 max-h-80 max-w-sm rounded-md border border-strong bg-black" />
    );
  }

  if (AUDIO_MIME_TYPES.has(attachment.mime)) {
    return <audio src={url} controls preload="metadata" className="mt-1.5 max-w-full" />;
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      download={attachment.name}
      className="mt-1.5 flex w-fit max-w-sm items-center gap-2 rounded-md border border-strong bg-bg-tertiary px-3 py-2 text-label transition-colors hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <FileIcon size={16} className="flex-none text-text-muted" />
      <span className="min-w-0 flex-1 truncate font-medium text-text-secondary">{attachment.name}</span>
      <span className="flex-none text-text-muted">{formatFileSize(attachment.size)}</span>
    </a>
  );
}

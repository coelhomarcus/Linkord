import { useState } from 'react';
import ReactPlayer from 'react-player';
import { ImageOff } from 'lucide-react';
import type { DetectedEmbed } from './lib/chatEmbeds';
import { ImageLightbox } from './ImageLightbox';
import { GenericEmbed } from './GenericEmbed';

/** Mostrado quando um link que reconhecemos como midia (imagem/video/audio)
 * falha ao carregar de verdade (link quebrado, protecao de hotlink, etc.) —
 * sem isso o usuario ficaria sem nenhuma pista nem como abrir o link
 * original. */
function EmbedFailedFallback({ url, className }: { url: string; className: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={`flex w-full max-w-sm items-center gap-2 rounded-md border border-strong bg-bg-tertiary px-3 py-2.5 text-label text-text-muted transition-colors hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 ${className}`}
    >
      <ImageOff size={14} className="flex-none" />
      <span className="truncate">Nao foi possivel carregar a previa. Abrir link</span>
    </a>
  );
}

interface LinkPreviewProps {
  embed: DetectedEmbed;
  /** Espaçamento/contexto de quem esta usando (chat encosta no texto de
   * cima com mt-1.5; um modal normalmente nao precisa de nada). */
  className?: string;
}

/** Preview de um link reconhecido (YouTube/Twitch/imagem/video/audio) no
 * chat (ver ChatEmbed, que so acrescenta a margem pro texto de cima).
 * YouTube/Twitch so carregam o iframe depois de um clique (evita autoplay/
 * som surpresa e trafego pra links que ninguem vai assistir) — video/audio/
 * imagem direta carregam na hora. */
export function LinkPreview({ embed, className = '' }: LinkPreviewProps) {
  const [failed, setFailed] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  // YouTube/Twitch/link generico compartilham o mesmo card (favicon + nome
  // do site + titulo + descricao, ver GenericEmbed) — so o que entra no
  // lugar da imagem muda por tipo. `key={embed.url}` garante que trocar de
  // link (ex.: mensagem editada, ou o mesmo componente reaproveitado pra
  // outro item numa lista) reinicia o estado interno em vez de arrastar o
  // do link anterior.
  if (embed.kind === 'youtube' || embed.kind === 'twitch-channel' || embed.kind === 'twitch-vod' || embed.kind === 'twitch-clip' || embed.kind === 'link') {
    return <GenericEmbed key={embed.url} embed={embed} className={className} />;
  }

  if (failed) return <EmbedFailedFallback url={embed.url} className={className} />;

  if (embed.kind === 'video') {
    return (
      <div className={`aspect-video w-full max-w-sm overflow-hidden rounded-md border border-strong bg-black ${className}`}>
        <ReactPlayer src={embed.url} controls width="100%" height="100%" onError={() => setFailed(true)} />
      </div>
    );
  }

  if (embed.kind === 'audio') {
    return <audio src={embed.url} controls preload="metadata" onError={() => setFailed(true)} className={`block w-full max-w-sm ${className}`} />;
  }

  // image — w-auto/h-auto (nao w-full+object-contain) deixa o navegador usar
  // a proporcao NATURAL da imagem, so limitada pelos tetos — sem isso sobra
  // espaco vazio na caixa quando a proporcao nao bate, que aparecia como
  // borda. Abre o mesmo lightbox de tela cheia que um anexo de upload usa
  // (ver ChatAttachment.tsx) — nao navega pro link, igual foi pedido.
  return (
    <>
      <button type="button" onClick={() => setLightboxOpen(true)} className={`block w-fit cursor-zoom-in ${className}`}>
        <img
          src={embed.url}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
          className="h-auto max-h-70 w-auto max-w-sm rounded-md border border-strong"
        />
      </button>
      <ImageLightbox src={embed.url} alt="" open={lightboxOpen} onOpenChange={setLightboxOpen} />
    </>
  );
}

import { useState } from 'react';
import { ImageOff } from 'lucide-react';
import type { DetectedEmbed } from './lib/chatEmbeds';
import { ImageLightbox } from './ImageLightbox';
import { GenericEmbed } from './GenericEmbed';
import { AudioPlayer, VideoPlayer } from './MediaPlayers';

function EmbedFailedFallback({ url, className }: { url: string; className: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={`flex w-full max-w-sm items-center gap-2 rounded-md border border-white/10 bg-bg-tertiary px-3 py-2.5 text-label text-text-muted transition-colors hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 ${className}`}
    >
      <ImageOff size={14} className="flex-none" />
      <span className="truncate">Nao foi possivel carregar a previa. Abrir link</span>
    </a>
  );
}

interface LinkPreviewProps {
  embed: DetectedEmbed;
  className?: string;
}

export function LinkPreview({ embed, className = '' }: LinkPreviewProps) {
  const [failed, setFailed] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  if (embed.kind === 'youtube' || embed.kind === 'twitch-channel' || embed.kind === 'twitch-vod' || embed.kind === 'twitch-clip' || embed.kind === 'link') {
    return <GenericEmbed key={embed.url} embed={embed} className={className} />;
  }

  if (failed) return <EmbedFailedFallback url={embed.url} className={className} />;

  if (embed.kind === 'video') {
    return <VideoPlayer src={embed.url} className={className} onError={() => setFailed(true)} />;
  }

  if (embed.kind === 'audio') {
    return <AudioPlayer src={embed.url} className={className} onError={() => setFailed(true)} />;
  }

  return (
    <>
      <button type="button" onClick={() => setLightboxOpen(true)} className={`block w-fit cursor-zoom-in ${className}`}>
        <img
          src={embed.url}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
          className="h-auto max-h-70 w-auto max-w-[min(24rem,100%)] rounded-md border border-white/10"
        />
      </button>
      <ImageLightbox src={embed.url} alt="" open={lightboxOpen} onOpenChange={setLightboxOpen} />
    </>
  );
}

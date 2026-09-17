import { useState } from 'react';
import { ImageOff } from 'lucide-react';
import type { DetectedEmbed } from '@/shared/lib/chatEmbeds';
import { ImageLightbox } from './ImageLightbox';
import { GenericEmbed } from './GenericEmbed';
import { AudioPlayer, VideoPlayer } from './MediaPlayers';
import { availableAttachmentWidth, useChatSurfaceWidth } from '@/shared/lib/chatSurfaceWidth';

function EmbedFailedFallback({ url, className }: { url: string; className: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={`flex w-full max-w-sm items-center gap-2 rounded-md border border-white/10 bg-bg-tertiary px-3 py-2.5 text-label text-text-muted transition-colors hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 ${className}`}
    >
      <ImageOff size={14} className="flex-none" />
      <span className="truncate">Não foi possível carregar a prévia. Abrir link</span>
    </a>
  );
}

interface LinkPreviewProps {
  embed: DetectedEmbed;
  className?: string;
  /** True when this is the message's only content — drops the outer
   * border/rounding so the preview fills the bubble instead of sitting in
   * a second frame nested inside it. */
  edgeToEdge?: boolean;
  /** True when this card's immediate parent already has a definite,
   * non-content-dependent width (e.g. a masonry grid column, which sets an
   * explicit pixel width on each item) — lets the bare-image case below
   * just fill it (`w-full`) instead of using the JS-computed chat-row
   * width cap. That cap exists because a chat message's real parent is a
   * flex item that hugs its own content (see chatSurfaceWidth.tsx), where
   * a CSS percentage can't resolve correctly — that reasoning doesn't
   * apply once the parent already has a real width, so forcing the same
   * fixed px cap there instead only made the image wider than its column,
   * overlapping the next one. */
  fitContainer?: boolean;
}

export function LinkPreview({ embed, className = '', edgeToEdge, fitContainer }: LinkPreviewProps) {
  const [failed, setFailed] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const surfaceWidth = useChatSurfaceWidth(384 + 120);
  const maxWidth = availableAttachmentWidth(surfaceWidth, 384);

  if (embed.kind === 'youtube' || embed.kind === 'twitch-channel' || embed.kind === 'twitch-vod' || embed.kind === 'twitch-clip' || embed.kind === 'link') {
    return <GenericEmbed key={embed.url} embed={embed} className={className} edgeToEdge={edgeToEdge} />;
  }

  if (failed) return <EmbedFailedFallback url={embed.url} className={className} />;

  if (embed.kind === 'video') {
    return <VideoPlayer src={embed.url} className={edgeToEdge ? 'rounded-2xl border-0' : className} onError={() => setFailed(true)} />;
  }

  if (embed.kind === 'audio') {
    return <AudioPlayer src={embed.url} className={edgeToEdge ? 'max-w-full rounded-2xl border-0 bg-transparent shadow-none' : className} onError={() => setFailed(true)} />;
  }

  return (
    <>
      <button type="button" onClick={() => setLightboxOpen(true)} className={`block max-w-full cursor-zoom-in ${className}`}>
        <img
          src={embed.url}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
          style={fitContainer ? undefined : { maxWidth }}
          className={`block h-auto max-h-70 max-w-full object-contain ${fitContainer ? 'w-full' : ''} ${edgeToEdge ? 'rounded-2xl' : 'rounded-md border border-white/10'}`}
        />
      </button>
      <ImageLightbox src={embed.url} alt="" open={lightboxOpen} onOpenChange={setLightboxOpen} />
    </>
  );
}

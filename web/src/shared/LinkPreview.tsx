import { useState } from 'react';
import { ImageOff } from 'lucide-react';
import type { DetectedEmbed } from './lib/chatEmbeds';
import { ImageLightbox } from './ImageLightbox';
import { GenericEmbed } from './GenericEmbed';
import { AudioPlayer, VideoPlayer } from './MediaPlayers';

/** Shown when a link we recognize as media (image/video/audio) actually
 * fails to load (broken link, hotlink protection, etc.) — otherwise the
 * user would have no clue or way to open the original link. */
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
  /** Spacing/context from whoever's using it (chat adds mt-1.5 to sit
   * under the text above; a modal usually needs none). */
  className?: string;
}

/** Preview of a recognized link (YouTube/Twitch/image/video/audio) in chat
 * (see ChatEmbed, which just adds the margin under the text). YouTube/Twitch
 * only load the iframe after a click (avoids surprise autoplay/sound and
 * traffic for links nobody will watch) — video/audio/image load right away. */
export function LinkPreview({ embed, className = '' }: LinkPreviewProps) {
  const [failed, setFailed] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  // YouTube/Twitch/generic link share the same card (favicon + site name +
  // title + description, see GenericEmbed) — only what replaces the image
  // changes per type. `key={embed.url}` resets internal state on a link
  // change (edited message, or the component reused for another list item)
  // instead of carrying over the previous link's state.
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

  // image — w-auto/h-auto (not w-full+object-contain) lets the browser use
  // the image's NATURAL aspect ratio, only capped by max-height/width —
  // otherwise empty space shows up as a border when the ratio doesn't match
  // the box. Opens the same fullscreen lightbox an upload attachment uses
  // (see ChatAttachment.tsx) instead of navigating to the link.
  return (
    <>
      <button type="button" onClick={() => setLightboxOpen(true)} className={`block w-fit cursor-zoom-in ${className}`}>
        <img
          src={embed.url}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
          className="h-auto max-h-70 w-auto max-w-[min(24rem,100%)] rounded-md border border-strong"
        />
      </button>
      <ImageLightbox src={embed.url} alt="" open={lightboxOpen} onOpenChange={setLightboxOpen} />
    </>
  );
}

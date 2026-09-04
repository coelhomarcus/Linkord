import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import ReactPlayer from 'react-player';
import { ExternalLink, Play } from 'lucide-react';
import type { DetectedEmbed } from './lib/chatEmbeds';
import { loadLinkPreview } from './lib/linkPreviewCache';
import type { LinkPreviewData } from './lib/api';

interface GenericEmbedProps {
  embed: DetectedEmbed;
  className?: string;
}

function isHexColor(color: string | null | undefined): color is string {
  return !!color && /^#[0-9a-f]{3,8}$/i.test(color);
}

// known site without depending on scraping — covers the whole card (name,
// favicon, accent color) when the link is YouTube/Twitch, whose player we
// already know how to build from just the ID extracted from the URL
// (chatEmbeds.ts). So if the Open Graph fetch fails (flaky network, site
// briefly down), the video/stream still plays — only the real description
// is missing.
const KNOWN_SITE: Partial<Record<DetectedEmbed['kind'], { name: string; favicon: string; accent: string }>> = {
  youtube: { name: 'YouTube', favicon: 'https://www.youtube.com/favicon.ico', accent: '#ff0000' },
  'twitch-channel': { name: 'Twitch', favicon: 'https://www.twitch.tv/favicon.ico', accent: '#9146ff' },
  'twitch-vod': { name: 'Twitch', favicon: 'https://www.twitch.tv/favicon.ico', accent: '#9146ff' },
  'twitch-clip': { name: 'Twitch', favicon: 'https://www.twitch.tv/favicon.ico', accent: '#9146ff' },
};

function TwitchPlayer({ embed }: { embed: DetectedEmbed }) {
  const [loaded, setLoaded] = useState(false);

  if (!loaded) {
    const label = embed.kind === 'twitch-channel'
      ? `twitch.tv/${embed.twitchChannel}`
      : embed.kind === 'twitch-vod'
        ? 'VOD da Twitch'
        : 'Clip da Twitch';
    return (
      // plain button on purpose: the whole area is clickable, not an icon button
      <button
        type="button"
        onClick={() => setLoaded(true)}
        className="flex aspect-video w-full items-center justify-center gap-2.5 bg-black/40 text-left transition-colors hover:bg-black/55 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span className="flex h-12 w-12 flex-none items-center justify-center rounded-full bg-[#9146FF] text-white">
          <Play size={18} fill="currentColor" />
        </span>
        <span className="text-label text-text-secondary">{label} — clique pra carregar o player</span>
      </button>
    );
  }

  const parent = window.location.hostname;
  let src = '';
  if (embed.kind === 'twitch-channel') src = `https://player.twitch.tv/?channel=${embed.twitchChannel}&parent=${parent}`;
  if (embed.kind === 'twitch-vod') src = `https://player.twitch.tv/?video=${embed.twitchVideoId}&parent=${parent}`;
  if (embed.kind === 'twitch-clip') src = `https://clips.twitch.tv/embed?clip=${embed.twitchClipSlug}&parent=${parent}`;
  return (
    <div className="aspect-video w-full">
      <iframe src={src} title="Twitch" className="h-full w-full" allowFullScreen />
    </div>
  );
}

/**
 * Link embed card, styled like Discord's link embed: colored bar on the
 * left, favicon + site name, highlighted title, truncated description, and
 * the player/image below. Covers THREE cases with the same look:
 *  - a generic link with no known format (kind:'link', see chatEmbeds.ts)
 *    — everything comes from Open Graph fetched on the server
 *    (server/linkPreview.ts);
 *  - YouTube/Twitch — the player takes the image's place, but title/
 *    description/favicon still come from that page's own Open Graph
 *    (YouTube and Twitch also publish those tags);
 *  - any link whose Open Graph points at a playable og:video (e.g. a post
 *    with an externally hosted mp4) — same logic as the generic link.
 */
export function GenericEmbed({ embed, className = '' }: GenericEmbedProps) {
  const { url } = embed;
  const [data, setData] = useState<LinkPreviewData | null>(null);
  const [imageFailed, setImageFailed] = useState(false);
  const [faviconFailed, setFaviconFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setImageFailed(false);
    setFaviconFailed(false);
    loadLinkPreview(url)
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setData({ url, title: null, description: null, image: null, video: null, favicon: null, siteName: url, themeColor: null }); });
    return () => { cancelled = true; };
  }, [url]);

  const known = KNOWN_SITE[embed.kind];
  const hasKnownPlayer = !!known;

  if (!data) {
    return (
      <div className={`flex w-full max-w-sm animate-pulse flex-col gap-1.5 rounded-md border border-strong bg-bg-tertiary px-3 py-2.5 ${className}`}>
        <div className="h-2.5 w-1/3 rounded-sm bg-bg-hover" />
        <div className="h-3.5 w-3/4 rounded-sm bg-bg-hover" />
      </div>
    );
  }

  // scraping didn't turn up anything usable (blocked, down, site with no
  // meta tags) — falls back to the minimal link-only card, EXCEPT when we
  // already know how to build the player from just the URL's ID (YouTube/
  // Twitch): in that case the video still plays, only the real description
  // is missing (see KNOWN_SITE).
  if (!data.title && !data.description && !data.image && !hasKnownPlayer) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className={`flex w-full max-w-sm items-center gap-2 rounded-md border border-strong bg-bg-tertiary px-3 py-2.5 text-label text-text-muted transition-colors hover:bg-bg-hover focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 ${className}`}
      >
        <ExternalLink size={14} className="flex-none" />
        <span className="truncate">{data.siteName}</span>
      </a>
    );
  }

  const siteName = data.siteName || known?.name || url;
  const favicon = !faviconFailed ? (data.favicon || known?.favicon) : null;
  const accent = isHexColor(data.themeColor) ? data.themeColor : (known?.accent ?? null);
  const playableVideo = !!data.video && (ReactPlayer.canPlay?.(data.video) ?? false);

  let media: ReactNode = null;
  if (embed.kind === 'youtube') {
    media = (
      <div className="aspect-video w-full bg-black">
        <ReactPlayer
          src={embed.url}
          light={data.image || `https://i.ytimg.com/vi/${embed.youtubeId}/hqdefault.jpg`}
          controls
          width="100%"
          height="100%"
          playIcon={
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-red text-white">
              <Play size={18} fill="currentColor" />
            </span>
          }
        />
      </div>
    );
  } else if (embed.kind === 'twitch-channel' || embed.kind === 'twitch-vod' || embed.kind === 'twitch-clip') {
    media = <div className="w-full bg-black"><TwitchPlayer embed={embed} /></div>;
  } else if (playableVideo) {
    media = (
      <div className="aspect-video w-full bg-black">
        <ReactPlayer src={data.video!} controls light={data.image || true} width="100%" height="100%" />
      </div>
    );
  } else if (data.image && !imageFailed) {
    media = (
      <img
        src={data.image}
        alt=""
        loading="lazy"
        onError={() => setImageFailed(true)}
        className="max-h-70 w-full object-cover"
      />
    );
  }

  return (
    <div
      className={`flex w-full max-w-sm flex-col overflow-hidden rounded-md border border-strong bg-bg-tertiary ${className}`}
      style={{ borderLeftWidth: 4, borderLeftColor: accent ?? 'var(--color-border-strong)' }}
    >
      <div className="flex flex-col gap-1 px-3 pt-2.5 pb-2">
        <div className="flex items-center gap-1.5 text-caption text-text-muted">
          {favicon && <img src={favicon} alt="" onError={() => setFaviconFailed(true)} className="h-3.5 w-3.5 flex-none rounded-[3px]" />}
          <span className="truncate">{siteName}</span>
        </div>
        {data.title && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="line-clamp-2 text-body font-medium text-blurple hover:underline"
          >
            {data.title}
          </a>
        )}
        {data.description && <p className="line-clamp-3 text-label text-text-secondary">{data.description}</p>}
      </div>

      {media}
    </div>
  );
}

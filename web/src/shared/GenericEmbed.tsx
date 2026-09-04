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

// site conhecido sem depender do scraping — cobre o card inteiro (nome,
// favicon, cor de destaque) quando o link e YouTube/Twitch, cujo player a
// gente ja sabe montar so com o ID extraido da URL (chatEmbeds.ts). Assim,
// se a busca de Open Graph falhar (rede instavel, site fora do ar por um
// instante), o video/stream ainda toca — so a descricao real que some.
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
      // botao cru de proposito: area clicavel inteira, nao um botao de icone
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
 * Card de embed de link, no estilo do embed de link do Discord: barra
 * colorida a esquerda, favicon + nome do site, titulo em destaque,
 * descricao truncada e o player/imagem embaixo. Cobre TRES situacoes com o
 * mesmo visual:
 *  - link generico sem formato conhecido (kind:'link', ver chatEmbeds.ts) —
 *    tudo vem do Open Graph buscado no servidor (server/linkPreview.js);
 *  - YouTube/Twitch — o player entra no lugar da imagem, mas o
 *    titulo/descricao/favicon ainda vem do Open Graph da propria pagina
 *    (YouTube e Twitch tambem publicam essas tags);
 *  - qualquer link cujo Open Graph aponte um og:video tocavel (ex.: um post
 *    com um mp4 hospedado por fora) — mesma logica do link generico.
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

  // scraping nao trouxe nada aproveitavel (bloqueado, fora do ar, site sem
  // meta tags) — cai pro card minimo so com o link, MENOS quando ja sabemos
  // montar o player so com o ID da URL (YouTube/Twitch): nesse caso o video
  // ainda toca, so a descricao real que fica de fora (ver KNOWN_SITE).
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

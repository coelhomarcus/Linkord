import { useCallback, useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Play, X } from 'lucide-react';
import { useAnimatedSidebar } from '@/components/motion/animated-sidebar';
import { Drawer } from '@/components/motion/drawer';
import { InfiniteMasonry } from '@/components/motion/infinite-masonry';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsIndicator, TabsTrigger } from '@/components/ui/tabs';
import { DocumentAttachmentCard } from '@/shared/DocumentAttachmentCard';
import { ImageLightbox } from '@/shared/ImageLightbox';
import { LinkPreview } from '@/shared/LinkPreview';
import { fetchMedia, ApiError } from '@/shared/lib/api';
import type { MediaItem, MediaKind } from '@/shared/lib/api';
import { SPRING_LAYOUT } from '@/shared/lib/ease';
import { IMAGE_MIME_TYPES, VIDEO_MIME_TYPES } from '../chat/ChatAttachment';

const PANEL_WIDTH = 360;

interface ConversationMediaPanelProps {
  conversationId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function UploadItemCard({ item, onOpenImage }: { item: MediaItem; onOpenImage: (src: string, alt: string) => void }) {
  const attachment = item.attachment;
  if (!attachment) return null;
  const url = `/uploads/${attachment.id}`;

  if (IMAGE_MIME_TYPES.has(attachment.mime)) {
    return (
      <button
        type="button"
        onClick={() => onOpenImage(url, attachment.name)}
        className="block w-full cursor-zoom-in overflow-hidden rounded-xl border border-white/10 bg-bg-tertiary transition-opacity hover:opacity-90"
      >
        {/* Fixed aspect ratio (not h-auto/intrinsic) — InfiniteMasonry
            positions items via an estimated height that gets corrected once
            the real element is measured, but an <img> with intrinsic sizing
            reports height 0 until its bytes finish loading, so the
            correction lands late and the row below (already positioned
            against the 0-height guess) ends up overlapping it. A fixed
            ratio makes the box's real height known at layout time, same
            fix already applied to the video card's aspect-video below. */}
        <img src={url} alt={attachment.name} loading="lazy" className="block aspect-square w-full object-cover" />
      </button>
    );
  }

  if (VIDEO_MIME_TYPES.has(attachment.mime)) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="group relative block aspect-video w-full overflow-hidden rounded-xl border border-white/10 bg-black"
      >
        <video src={`${url}#t=0.1`} muted preload="metadata" playsInline className="pointer-events-none block h-full w-full object-cover" />
        <span className="absolute inset-0 flex items-center justify-center bg-black/25 transition-colors group-hover:bg-black/40">
          <span className="grid size-10 place-items-center rounded-full bg-black/60 text-white">
            <Play size={18} fill="currentColor" className="ml-0.5" />
          </span>
        </span>
      </a>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      download={attachment.name}
      className="flex w-full items-center rounded-xl border border-white/10 bg-bg-tertiary px-3 py-3 transition-colors hover:bg-bg-hover"
    >
      <DocumentAttachmentCard name={attachment.name} size={attachment.size} mime={attachment.mime} className="min-w-0 flex-1" />
    </a>
  );
}

export function ConversationMediaPanel({ conversationId, open, onOpenChange }: ConversationMediaPanelProps) {
  const { isMobile } = useAnimatedSidebar();
  const [kind, setKind] = useState<MediaKind>('uploads');
  const [items, setItems] = useState<MediaItem[]>([]);
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  // Starts true (not false) so InfiniteMasonry's very first render already
  // takes its virtualized branch instead of the empty-state one — the
  // empty-state branch never mounts the ref it measures its column width
  // from, and that ref is wired up in an effect keyed on the ref object
  // itself, which doesn't re-fire once a later render swaps in the real,
  // ref-holding element. Mounting straight into "loading" sidesteps it.
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null);

  const load = useCallback(async (targetConversationId: string, targetKind: MediaKind, before: number | null, replace: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const page = await fetchMedia(targetKind, before, targetConversationId);
      setItems((prev) => (replace ? page.items : [...prev, ...page.items]));
      setNextBefore(page.nextBefore);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível carregar.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open || !conversationId) return;
    setItems([]);
    setNextBefore(null);
    setError(null);
    load(conversationId, kind, null, true);
  }, [open, conversationId, kind, load]);

  useEffect(() => {
    if (!open) setKind('uploads');
  }, [open]);

  const content = conversationId && (
    <>
      <div className="flex flex-none items-center gap-2 border-b border-white/10 px-5 py-4">
        <h2 className="flex-1 text-title font-semibold">Mídias e links</h2>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Fechar" onClick={() => onOpenChange(false)}>
          <X size={16} />
        </Button>
      </div>

      <div className="flex flex-none items-center px-5 pt-4">
        <Tabs value={kind} onValueChange={(v) => v && setKind(v as MediaKind)} className="w-fit">
          <TabsList>
            <TabsIndicator />
            <TabsTrigger value="uploads">Enviadas</TabsTrigger>
            <TabsTrigger value="embeds">Embeds</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="min-h-0 flex-1 px-4 pb-4 pt-3">
        <InfiniteMasonry
          items={items}
          // attachment.id, not msgId — a message can carry more than one
          // attachment (e.g. the 4-image grid), and the uploads query
          // returns one row per attachment, so msgId alone collides. A
          // duplicate key breaks the virtualizer's lane bookkeeping, which
          // is exactly what showed up as every image stacking at (0,0).
          getItemKey={(item) => `${item.msgId}:${item.attachment?.id ?? 'embed'}`}
          renderItem={(item) => (
            kind === 'uploads' ? (
              <UploadItemCard item={item} onOpenImage={(src, alt) => setLightbox({ src, alt })} />
            ) : item.embed ? (
              <LinkPreview embed={item.embed} className="w-full max-w-full" />
            ) : null
          )}
          onLoadMore={() => { if (conversationId && nextBefore != null) load(conversationId, kind, nextBefore, false); }}
          hasMore={nextBefore != null}
          loading={loading}
          error={error}
          onRetry={() => { if (conversationId) load(conversationId, kind, nextBefore, false); }}
          estimateSize={() => (kind === 'uploads' ? 180 : 220)}
          minColumnWidth={140}
          maxColumns={2}
          gap={10}
          className="h-full border-0 rounded-none bg-transparent p-0"
          emptyState={
            <div className="flex h-full min-h-48 flex-col items-center justify-center px-6 text-center">
              <p className="select-none text-label text-text-muted">
                {kind === 'uploads' ? 'Nenhum arquivo enviado ainda.' : 'Nenhum link incorporável compartilhado ainda.'}
              </p>
            </div>
          }
          ariaLabel={kind === 'uploads' ? 'Arquivos enviados' : 'Links compartilhados'}
        />
      </div>
    </>
  );

  return (
    <>
      {isMobile ? (
        <Drawer
          open={open && !!conversationId}
          onOpenChange={onOpenChange}
          ariaLabel="Mídias e links"
          className="flex w-96 flex-col border-white/10 bg-[rgb(14_14_16)] text-text-primary"
        >
          {content}
        </Drawer>
      ) : (
        <motion.aside
          aria-label="Mídias e links"
          aria-hidden={!open || !conversationId}
          initial={false}
          animate={{ width: open && conversationId ? PANEL_WIDTH : 0, opacity: open && conversationId ? 1 : 0 }}
          transition={SPRING_LAYOUT}
          className="flex-none overflow-hidden bg-bg-primary text-text-primary will-change-[width]"
        >
          <div className="flex h-full flex-col" style={{ width: PANEL_WIDTH }}>
            {content}
          </div>
        </motion.aside>
      )}

      <ImageLightbox
        src={lightbox?.src ?? ''}
        alt={lightbox?.alt ?? ''}
        open={!!lightbox}
        onOpenChange={(next) => { if (!next) setLightbox(null); }}
      />
    </>
  );
}

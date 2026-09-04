import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { fetchMedia } from '@/shared/lib/api';
import type { MediaItem, MediaKind } from '@/shared/lib/api';
import { ApiError } from '@/shared/lib/api';
import { Avatar } from '@/shared/Avatar';
import { ChatAttachment } from '../chat/ChatAttachment';
import { LinkPreview } from '@/shared/LinkPreview';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsIndicator, TabsTrigger } from '@/components/ui/tabs';

function formatWhen(ts: number): string {
  return new Date(ts).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function MediaRow({ item }: { item: MediaItem }) {
  return (
    <div className="flex flex-col gap-1.5 border-b border-subtle pb-4 last:border-0 last:pb-0">
      <div className="flex min-w-0 items-center gap-2 text-label text-text-muted">
        <Avatar id={item.authorName} name={item.authorName} avatar={item.authorAvatar} size={20} />
        <span className="flex-none font-medium text-text-secondary">{item.authorName}</span>
        <span className="min-w-0 truncate">em #{item.channelName}</span>
        <span className="ml-auto flex-none">{formatWhen(item.ts)}</span>
      </div>
      {item.attachment && <ChatAttachment attachment={item.attachment} />}
      {item.embed && <LinkPreview embed={item.embed} className="mt-0" />}
    </div>
  );
}

/** Aba "Midias" dos Ajustes — agrega todo anexo enviado e todo link
 * embutivel do PROJETO INTEIRO (todos os canais, nao so o aberto no
 * momento), separados em duas listas (server/media.js decide a
 * classificacao; aqui so desenha, reaproveitando ChatAttachment/LinkPreview
 * — o mesmo componente que o proprio chat usa pra renderizar essas mesmas
 * coisas). Busca sob demanda: so carrega quando essa aba e aberta de
 * verdade (TabsPanel desmonta o conteudo das abas inativas por padrao, ver
 * SettingsModal), e refaz do zero cada vez que reabre — sem cache, mas o
 * app e pequeno o bastante (uma sala, poucos participantes) pra isso nunca
 * pesar. */
export function MediaTab() {
  const [kind, setKind] = useState<MediaKind>('uploads');
  const [items, setItems] = useState<MediaItem[]>([]);
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (targetKind: MediaKind, before: number | null, replace: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const page = await fetchMedia(targetKind, before);
      setItems((prev) => (replace ? page.items : [...prev, ...page.items]));
      setNextBefore(page.nextBefore);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Nao foi possivel carregar as midias.');
    } finally {
      setLoading(false);
      setLoadedOnce(true);
    }
  }, []);

  // troca de aba (uploads/embeds) reseta a lista e busca do zero — cada uma
  // tem sua propria paginacao (cursor de uma nao serve pra outra).
  useEffect(() => {
    setItems([]);
    setNextBefore(null);
    setLoadedOnce(false);
    load(kind, null, true);
  }, [kind, load]);

  return (
    <div className="flex flex-col gap-4">
      <Tabs value={kind} onValueChange={(v) => v && setKind(v as MediaKind)} className="w-fit">
        <TabsList>
          <TabsIndicator />
          <TabsTrigger value="uploads">Enviadas</TabsTrigger>
          <TabsTrigger value="embeds">Embeds</TabsTrigger>
        </TabsList>
      </Tabs>

      {error && <p className="select-none text-label text-red">{error}</p>}

      {!error && loadedOnce && items.length === 0 && (
        <p className="select-none text-label text-text-muted">
          {kind === 'uploads' ? 'Nenhum arquivo enviado ainda.' : 'Nenhum link embutivel compartilhado ainda.'}
        </p>
      )}

      {items.length > 0 && (
        <div className="flex flex-col gap-4">
          {items.map((item) => <MediaRow key={item.msgId} item={item} />)}
        </div>
      )}

      {loading && items.length === 0 && <p className="select-none text-label text-text-muted">Carregando…</p>}

      {nextBefore != null && (
        <Button type="button" variant="outline" size="sm" className="w-fit self-center" disabled={loading} onClick={() => load(kind, nextBefore, false)}>
          {loading && <Loader2 size={14} className="animate-spin" />}
          <span>Carregar mais</span>
        </Button>
      )}
    </div>
  );
}

import { fetchLinkPreview, type LinkPreviewData } from './api';

/**
 * Cache em memoria (aba atual, some no reload) do preview de cada URL —
 * o mesmo link pode aparecer varias vezes na mesma sessao (reaparece ao
 * rolar o chat, e de novo na aba Midias dos Ajustes); sem isso cada
 * aparicao repetiria a chamada pro backend (que por sua vez ja tem seu
 * proprio cache de 6h, mas nao ha motivo pra pagar nem essa ida-e-volta de
 * rede de novo). Dedup de requisicoes concorrentes via `pending`: duas
 * mensagens com o mesmo link chegando juntas na tela disparam SO uma
 * chamada.
 */
const cache = new Map<string, LinkPreviewData>();
const pending = new Map<string, Promise<LinkPreviewData>>();

export function getCachedLinkPreview(url: string): LinkPreviewData | undefined {
  return cache.get(url);
}

export function loadLinkPreview(url: string): Promise<LinkPreviewData> {
  const cached = cache.get(url);
  if (cached) return Promise.resolve(cached);

  const inFlight = pending.get(url);
  if (inFlight) return inFlight;

  const promise = fetchLinkPreview(url)
    .then((data) => {
      cache.set(url, data);
      return data;
    })
    .finally(() => {
      pending.delete(url);
    });
  pending.set(url, promise);
  return promise;
}

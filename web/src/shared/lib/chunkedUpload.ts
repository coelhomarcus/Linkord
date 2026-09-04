import { ApiError } from './api';

/** Upload de anexo de chat em pedacos (chunks) — necessario pro teto de 2GB
 * (ver server/attachments.js): um POST unico desse tamanho nem passa de
 * proxy nenhum na frente (Cloudflare/nginx barram corpo de requisicao
 * grande) nem seria seguro o servidor segurar inteiro em memoria de uma vez.
 * Fluxo: init (declara o arquivo, servidor devolve o tamanho de chunk) ->
 * N chunks (concorrencia limitada, com retry) -> complete (servidor monta o
 * arquivo e cria a mensagem). Em falha irrecuperavel, cancela a sessao no
 * servidor pra nao deixar chunk orfao ate a varredura periodica pegar. */

interface InitResponse {
  uploadId: string;
  chunkSize: number;
  totalChunks: number;
}

export interface ChunkedUploadOptions {
  channelId: string;
  file: File;
  caption: string;
  onProgress?: (fraction: number) => void;
}

async function toApiError(res: Response): Promise<ApiError> {
  let body: unknown = null;
  try { body = await res.json(); } catch { /* corpo vazio/nao-JSON */ }
  const err = (body && typeof body === 'object' ? (body as { error?: { code?: string; message?: string } }).error : null) || {};
  return new ApiError(res.status, err.code || 'unknown_error', err.message || 'Erro inesperado.');
}

/** Roda `task(i)` pra i em [0, count), no maximo `limit` em paralelo — para
 * na primeira falha (as tasks em voo terminam, mas nenhuma nova comeca). */
async function runWithConcurrency(count: number, limit: number, task: (i: number) => Promise<void>): Promise<void> {
  let next = 0;
  let firstError: unknown;
  async function worker() {
    while (next < count) {
      const i = next++;
      try {
        await task(i);
      } catch (err) {
        if (firstError === undefined) firstError = err;
        return;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, count) }, worker));
  if (firstError !== undefined) throw firstError;
}

const MAX_CHUNK_RETRIES = 3;
const MAX_CONCURRENT_CHUNKS = 3;

export async function uploadFileInChunks({ channelId, file, caption, onProgress }: ChunkedUploadOptions): Promise<void> {
  const initRes = await fetch('/api/attachments/init', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channelId, fileName: file.name, mimeType: file.type || 'application/octet-stream', totalSize: file.size, caption }),
  });
  if (!initRes.ok) throw await toApiError(initRes);
  const { uploadId, chunkSize, totalChunks } = await initRes.json() as InitResponse;

  // progresso agregado por bytes CONFIRMADOS por chunk — granularidade de
  // ~8MB, suficiente pra uma barra de progresso legivel mesmo num arquivo de
  // ate 2GB (fetch nao tem evento de progresso de upload, e nao precisa: o
  // ganho de granularidade fina nao compensa trazer XHR so pra isso aqui).
  const sentPerChunk = new Array(totalChunks).fill(0);
  function reportProgress() {
    if (file.size <= 0) return;
    const sent = sentPerChunk.reduce((a, b) => a + b, 0);
    onProgress?.(sent / file.size);
  }

  async function uploadChunk(index: number): Promise<void> {
    const start = index * chunkSize;
    const end = Math.min(start + chunkSize, file.size);
    const blob = file.slice(start, end);
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await fetch(`/api/attachments/${uploadId}/chunk/${index}`, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: blob,
        });
        if (!res.ok) throw await toApiError(res);
        sentPerChunk[index] = blob.size;
        reportProgress();
        return;
      } catch (err) {
        if (attempt >= MAX_CHUNK_RETRIES) throw err;
      }
    }
  }

  try {
    await runWithConcurrency(totalChunks, MAX_CONCURRENT_CHUNKS, uploadChunk);
  } catch (err) {
    // best-effort: libera os chunks no servidor na hora em vez de esperar a
    // varredura periodica (server/attachments.js#sweepStaleUploads).
    fetch(`/api/attachments/${uploadId}`, { method: 'DELETE', credentials: 'same-origin' }).catch(() => {});
    throw err;
  }

  const completeRes = await fetch(`/api/attachments/${uploadId}/complete`, { method: 'POST', credentials: 'same-origin' });
  if (!completeRes.ok) throw await toApiError(completeRes);
}

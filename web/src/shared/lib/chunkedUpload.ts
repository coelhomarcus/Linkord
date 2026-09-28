import { ApiError } from '@/shared/api/api';
import { logger } from '@/shared/lib/logger';

const log = logger.child({ component: 'upload' });


interface InitResponse {
  uploadId: string;
  chunkSize: number;
  totalChunks: number;
}

async function toApiError(res: Response): Promise<ApiError> {
  let body: unknown = null;
  try { body = await res.json(); } catch {  }
  const err = (body && typeof body === 'object' ? (body as { error?: { code?: string; message?: string } }).error : null) || {};
  return new ApiError(res.status, err.code || 'unknown_error', err.message || 'Erro inesperado.', res.headers.get('Retry-After') ?? undefined);
}

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
const RETRY_BASE_MS = 500;
const MAX_INIT_RATE_LIMIT_WAITS = 3;
const MAX_RETRY_AFTER_MS = 60_000;

export interface StagedFile { id: string; name: string; mime: string; size: number; thumbId?: string }

// A 4xx says the request itself is wrong (no access, too big, gone) —
// sending it again can't help. Timeouts, rate limits and 5xx can.
function isRetryable(err: unknown): boolean {
  if (!(err instanceof ApiError)) return true; // network failure
  return err.status >= 500 || err.status === 408 || err.status === 429;
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
  });
}

interface UploadRun {
  conversationId: string;
  file: File;
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

/** Stages the file: uploaded in chunks, but not published to anyone. The
 * message that carries it (with the whole batch) is created later by one
 * correlated `chat` send — see stageFileInChunks below, its only caller. */
async function runUpload({ conversationId, file, onProgress, signal }: UploadRun): Promise<unknown> {
  if (!conversationId) throw new ApiError(400, 'missing_conversation', 'Conversa não informada.');
  let initRes: Response;
  // several batches in a row can hit the server's per-minute cap on new
  // uploads; wait out its Retry-After rather than failing the file
  for (let attempt = 0; ; attempt++) {
    initRes = await fetch('/api/attachments/init', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId, fileName: file.name, mimeType: file.type || 'application/octet-stream', totalSize: file.size }),
      signal,
    });
    if (initRes.ok) break;
    const err = await toApiError(initRes);
    if (err.status !== 429 || attempt >= MAX_INIT_RATE_LIMIT_WAITS) throw err;
    const seconds = Number(err.retryAfter);
    await wait(Math.min(MAX_RETRY_AFTER_MS, Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : RETRY_BASE_MS * 2 ** attempt), signal);
  }
  const { uploadId, chunkSize, totalChunks } = await initRes.json() as InitResponse;

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
          signal,
        });
        if (!res.ok) throw await toApiError(res);
        sentPerChunk[index] = blob.size;
        reportProgress();
        return;
      } catch (err) {
        if (signal?.aborted || attempt >= MAX_CHUNK_RETRIES || !isRetryable(err)) throw err;
        await wait(RETRY_BASE_MS * 2 ** attempt, signal);
      }
    }
  }

  try {
    await runWithConcurrency(totalChunks, MAX_CONCURRENT_CHUNKS, uploadChunk);
  } catch (err) {
    if (!signal?.aborted) log.error('upload failed', err, { uploadId, bytes: file.size, type: file.type, chunks: totalChunks });
    fetch(`/api/attachments/${uploadId}`, { method: 'DELETE', credentials: 'same-origin' }).catch(() => {});
    throw err;
  }

  // complete is safe to repeat (the server answers a repeat with the same
  // staged file), so a lost reply is retried instead of failing the file
  for (let attempt = 0; ; attempt++) {
    try {
      const completeRes = await fetch(`/api/attachments/${uploadId}/complete`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
        signal,
      });
      if (!completeRes.ok) throw await toApiError(completeRes);
      return await completeRes.json();
    } catch (err) {
      if (signal?.aborted || attempt >= MAX_CHUNK_RETRIES || !isRetryable(err)) {
        fetch(`/api/attachments/${uploadId}`, { method: 'DELETE', credentials: 'same-origin' }).catch(() => {});
        throw err;
      }
      await wait(RETRY_BASE_MS * 2 ** attempt, signal);
    }
  }
}

/** Uploads the file without publishing it; the message that carries it is
 * created later, with the whole batch, by one correlated chat send. */
export async function stageFileInChunks(options: { conversationId: string; file: File; onProgress?: (fraction: number) => void; signal?: AbortSignal }): Promise<StagedFile> {
  const body = await runUpload(options) as { staged: StagedFile };
  return body.staged;
}

/** Drops a staged file the user gave up on; best effort — expiry cleans up otherwise. */
export function discardStagedFile(id: string): void {
  fetch(`/api/attachments/${id}`, { method: 'DELETE', credentials: 'same-origin' }).catch(() => {});
}

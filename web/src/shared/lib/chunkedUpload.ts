import { ApiError } from './api';

/** Uploads a chat attachment in chunks — needed for the 2GB cap (see
 * server/src/modules/attachments.ts): a single POST that size wouldn't get
 * past any proxy in front (Cloudflare/nginx block large request bodies),
 * nor would it be safe for the server to hold it all in memory at once.
 * Flow: init (declares the file, server returns the chunk size) -> N chunks
 * (limited concurrency, with retry) -> complete (server assembles the file
 * and creates the message). On unrecoverable failure, cancels the session
 * on the server so no chunk sits orphaned until the periodic sweep. */

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
  try { body = await res.json(); } catch { /* empty/non-JSON body */ }
  const err = (body && typeof body === 'object' ? (body as { error?: { code?: string; message?: string } }).error : null) || {};
  return new ApiError(res.status, err.code || 'unknown_error', err.message || 'Erro inesperado.');
}

/** Runs `task(i)` for i in [0, count), at most `limit` in parallel — stops
 * on the first failure (in-flight tasks finish, no new ones start). */
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

function retryDelayMs(attempt: number, response?: Response): number {
  const retryAfter = response?.headers.get('Retry-After');
  const seconds = retryAfter == null ? Number.NaN : Number(retryAfter);
  if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds * 1000, 10_000);
  return Math.min(250 * 2 ** attempt, 2000);
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function cancelUpload(uploadId: string): Promise<void> {
  try {
    await fetch(`/api/attachments/${uploadId}`, { method: 'DELETE', credentials: 'same-origin' });
  } catch { /* best effort — the server's stale-session sweep is the fallback */ }
}

export async function uploadFileInChunks({ channelId, file, caption, onProgress }: ChunkedUploadOptions): Promise<void> {
  const initRes = await fetch('/api/attachments/init', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channelId, fileName: file.name, mimeType: file.type || 'application/octet-stream', totalSize: file.size, caption }),
  });
  if (!initRes.ok) throw await toApiError(initRes);
  const { uploadId, chunkSize, totalChunks } = await initRes.json() as InitResponse;

  // progress aggregated by bytes CONFIRMED per chunk — ~8MB granularity,
  // enough for a readable progress bar even on a file up to 2GB (fetch has
  // no upload-progress event, and doesn't need one: the finer granularity
  // isn't worth pulling in XHR just for this).
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
      let response: Response;
      try {
        response = await fetch(`/api/attachments/${uploadId}/chunk/${index}`, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: blob,
        });
      } catch (err) {
        if (attempt >= MAX_CHUNK_RETRIES) throw err;
        await wait(retryDelayMs(attempt));
        continue;
      }
      if (!response.ok) {
        const error = await toApiError(response);
        if (attempt >= MAX_CHUNK_RETRIES || !isRetryableStatus(response.status)) throw error;
        await wait(retryDelayMs(attempt, response));
        continue;
      }
      sentPerChunk[index] = blob.size;
      reportProgress();
      return;
    }
  }

  try {
    await runWithConcurrency(totalChunks, MAX_CONCURRENT_CHUNKS, uploadChunk);
  } catch (err) {
    // best-effort: frees the chunks on the server right away instead of
    // waiting for the periodic sweep (attachments.ts#sweepStaleUploads).
    void cancelUpload(uploadId);
    throw err;
  }

  for (let attempt = 0; ; attempt += 1) {
    let completeRes: Response;
    try {
      completeRes = await fetch(`/api/attachments/${uploadId}/complete`, { method: 'POST', credentials: 'same-origin' });
    } catch (err) {
      if (attempt < MAX_CHUNK_RETRIES) {
        await wait(retryDelayMs(attempt));
        continue;
      }
      await cancelUpload(uploadId);
      throw err;
    }
    if (completeRes.ok) break;
    const error = await toApiError(completeRes);
    if (attempt < MAX_CHUNK_RETRIES && isRetryableStatus(completeRes.status)) {
      await wait(retryDelayMs(attempt, completeRes));
      continue;
    }
    await cancelUpload(uploadId);
    throw error;
  }
}

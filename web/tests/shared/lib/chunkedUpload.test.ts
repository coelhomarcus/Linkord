import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stageFileInChunks } from '@/shared/lib/chunkedUpload';

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

describe('stageFileInChunks', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('new-upload rate limit (429): waits for Retry-After and retries, without failing the file', async () => {
    const calls: string[] = [];
    let inits = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(url);
      if (url === '/api/attachments/init') {
        inits++;
        return inits === 1
          ? json(429, { error: { code: 'rate_limited', message: 'slow down' } }, { 'Retry-After': '7' })
          : json(201, { uploadId: 'u1', chunkSize: 10, totalChunks: 1 });
      }
      if (url.endsWith('/chunk/0')) return json(200, { received: 0 });
      return json(201, { staged: { id: 'u1', name: 'a.pdf', mime: 'application/pdf', size: 3 } });
    }));

    const promise = stageFileInChunks({ conversationId: 'c', file: new File(['abc'], 'a.pdf', { type: 'application/pdf' }) });
    await vi.advanceTimersByTimeAsync(6_900);
    expect(inits).toBe(1);
    await vi.advanceTimersByTimeAsync(200);
    await expect(promise).resolves.toMatchObject({ id: 'u1' });
    expect(inits).toBe(2);
  });

  it('a definitive error on init (403) is not retried', async () => {
    const fetchMock = vi.fn(async () => json(403, { error: { code: 'relationship_required', message: 'friends only' } }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(stageFileInChunks({ conversationId: 'c', file: new File(['a'], 'a.pdf') })).rejects.toMatchObject({ status: 403 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '@/shared/api/api';
import { __resetLinkPreviewCacheForTests, getCachedLinkPreview, loadLinkPreview } from '@/shared/lib/linkPreviewCache';

vi.mock('@/shared/api/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/shared/api/api')>()), fetchLinkPreview: vi.fn() }));
const fetchLinkPreview = vi.mocked(api.fetchLinkPreview);
const preview = (url: string) => ({ url, title: url, description: null, image: null, video: null, favicon: null, siteName: url, themeColor: null });

describe('linkPreviewCache', () => {
  beforeEach(() => { __resetLinkPreviewCacheForTests(); fetchLinkPreview.mockReset(); fetchLinkPreview.mockImplementation(async (url) => preview(url)); });
  afterEach(() => { vi.useRealTimers(); });

  it('pedidos simultaneos da mesma URL viram um so', async () => {
    await Promise.all([loadLinkPreview('https://a.com'), loadLinkPreview('https://a.com')]);
    expect(fetchLinkPreview).toHaveBeenCalledTimes(1);
  });

  it('expira depois do TTL', async () => {
    vi.useFakeTimers();
    await loadLinkPreview('https://a.com');
    vi.advanceTimersByTime(31 * 60 * 1000);
    expect(getCachedLinkPreview('https://a.com')).toBeUndefined();
  });

  it('guarda no maximo 200 entradas, descartando as menos usadas', async () => {
    for (let i = 0; i < 201; i++) await loadLinkPreview(`https://site${i}.com`);
    expect(getCachedLinkPreview('https://site0.com')).toBeUndefined();
    expect(getCachedLinkPreview('https://site200.com')).toBeDefined();
  });
});

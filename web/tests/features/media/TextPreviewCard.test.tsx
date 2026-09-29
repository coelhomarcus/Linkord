import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TextPreviewCard, __resetPreviewCacheForTests } from '@/features/media/TextPreviewCard';

vi.mock('@/shared/lib/highlightCode', () => ({ highlightCode: vi.fn(async () => null) }));

function mockFetchOnce(response: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => response })));
}

describe('TextPreviewCard', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    __resetPreviewCacheForTests();
  });

  it('renders markdown (a heading becomes <h1>, never shows up as raw text)', async () => {
    mockFetchOnce({ previewable: true, content: '# Hi\n\ntext', truncated: false, totalSize: 20, language: 'markdown' });
    render(<TextPreviewCard attachment={{ id: 'md-id', name: 'notes.md', mime: 'text/markdown', size: 20 }} />);

    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Hi' })).toBeInTheDocument());
  });

  it('sanitizes a markdown link with a dangerous scheme (javascript:)', async () => {
    mockFetchOnce({ previewable: true, content: '[click](javascript:alert(1))', truncated: false, totalSize: 30, language: 'markdown' });
    render(<TextPreviewCard attachment={{ id: 'md-id', name: 'notes.md', mime: 'text/markdown', size: 30 }} />);

    const link = await screen.findByText('click');
    expect(link.closest('a')?.getAttribute('href')).not.toBe('javascript:alert(1)');
  });

  it('a code file with no highlighting available falls back to a plain <pre>', async () => {
    mockFetchOnce({ previewable: true, content: 'print(1)', truncated: false, totalSize: 8, language: 'python' });
    render(<TextPreviewCard attachment={{ id: 'py-id', name: 'script.py', mime: 'text/x-python', size: 8 }} />);

    await waitFor(() => expect(screen.getByText('print(1)').tagName).toBe('PRE'));
  });

  it('the "Show more/less" button toggles the collapsed height', async () => {
    const user = userEvent.setup();
    mockFetchOnce({ previewable: true, content: 'single line', truncated: false, totalSize: 11, language: 'text' });
    render(<TextPreviewCard attachment={{ id: 'txt-id', name: 'notes.txt', mime: 'text/plain', size: 11 }} />);

    const toggle = await screen.findByRole('button', { name: /Mostrar mais/ });
    await user.click(toggle);
    expect(screen.getByRole('button', { name: /Mostrar menos/ })).toBeInTheDocument();
  });

  it('shows "Baixar pra ver tudo" only when truncated', async () => {
    mockFetchOnce({ previewable: true, content: 'just a piece', truncated: true, totalSize: 999999, language: 'text' });
    render(<TextPreviewCard attachment={{ id: 'txt-id', name: 'log.txt', mime: 'text/plain', size: 999999 }} />);

    expect(await screen.findByText('Baixar pra ver tudo')).toBeInTheDocument();
  });

  it('previewable false shows no preview body, only the file card', async () => {
    mockFetchOnce({ previewable: false });
    render(<TextPreviewCard attachment={{ id: 'bin-id', name: 'data.log', mime: 'text/plain', size: 50 }} />);

    await waitFor(() => expect(screen.queryByRole('button', { name: /Mostrar mais/ })).not.toBeInTheDocument());
    expect(screen.getByTitle('data.log')).toBeInTheDocument();
  });
});

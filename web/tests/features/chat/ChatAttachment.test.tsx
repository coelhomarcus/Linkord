import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatAttachment } from '@/features/chat/ChatAttachment';

// Keeps this test off the real shiki/WASM init path — highlightCode's own
// correctness isn't this file's concern, just that ChatAttachment routes to
// TextPreviewCard and the fetched content ends up on screen.
vi.mock('@/shared/lib/highlightCode', () => ({ highlightCode: vi.fn(async () => null) }));

describe('ChatAttachment', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('imagem usa a miniatura (thumbId) quando existe, nao o original', () => {
    const { container } = render(<ChatAttachment attachment={{ id: 'img-id', thumbId: 'thumb-id', name: 'foto.png', mime: 'image/png', size: 789 }} />);
    expect(container.querySelector('img')).toHaveAttribute('src', '/uploads/thumb-id');
  });

  it('imagem sem thumbId cai pro original', () => {
    const { container } = render(<ChatAttachment attachment={{ id: 'img-id', name: 'foto.png', mime: 'image/png', size: 789 }} />);
    expect(container.querySelector('img')).toHaveAttribute('src', '/uploads/img-id');
  });

  it('arquivo generico (nao previsualizavel) vira link de download simples', () => {
    render(<ChatAttachment attachment={{ id: 'zip-id', name: 'projeto.zip', mime: 'application/zip', size: 999 }} />);
    const link = screen.getByText('projeto.zip').closest('a');
    expect(link).toHaveAttribute('href', '/uploads/zip-id');
    expect(link).toHaveAttribute('download', 'projeto.zip');
  });

  it('arquivo de texto/codigo busca o preview e mostra o conteudo', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ previewable: true, content: 'print("oi")', truncated: false, totalSize: 12, language: 'python' }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    render(<ChatAttachment attachment={{ id: 'py-id', name: 'script.py', mime: 'text/x-python', size: 12 }} />);

    expect(fetchMock).toHaveBeenCalledWith('/api/attachments/py-id/preview', { credentials: 'same-origin' });
    await waitFor(() => expect(screen.getByText('print("oi")')).toBeInTheDocument());
  });

  it('renderiza upload de video com o player proprio e lightbox interno', async () => {
    const user = userEvent.setup();
    vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    const { container } = render(<ChatAttachment attachment={{ id: 'video-id', name: 'clip.mp4', mime: 'video/mp4', size: 123 }} />);

    const video = container.querySelector('video');
    expect(video).toHaveAttribute('src', '/uploads/video-id');
    expect(video).not.toHaveAttribute('controls');
    expect(screen.getByRole('button', { name: 'Reproduzir' })).toBeInTheDocument();
    expect(container.querySelector('[aria-label="Volume"]')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Tela cheia' }));
    expect(screen.getByRole('button', { name: 'Fechar' })).toBeInTheDocument();
  });

  it('renderiza upload de audio com o player proprio', () => {
    const { container } = render(<ChatAttachment attachment={{ id: 'audio-id', name: 'voz.mp3', mime: 'audio/mpeg', size: 456 }} />);

    const audio = container.querySelector('audio');
    expect(audio).toHaveAttribute('src', '/uploads/audio-id');
    expect(audio).not.toHaveAttribute('controls');
    expect(screen.getByText('voz.mp3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reproduzir' })).toBeInTheDocument();
    expect(container.querySelector('[aria-label="Volume"]')).toBeInTheDocument();
  });
});

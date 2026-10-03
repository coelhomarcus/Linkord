import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { __resetLinkPreviewCacheForTests } from '@/shared/lib/linkPreviewCache';
import userEvent from '@testing-library/user-event';
import { LinkPreview } from '@/features/media/LinkPreview';

describe('LinkPreview', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders a direct video embed with its own player and inner lightbox', async () => {
    const user = userEvent.setup();
    vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    const { container } = render(<LinkPreview embed={{ kind: 'video', url: 'https://cdn.example.com/video.mp4' }} />);

    const video = container.querySelector('video');
    expect(video).toHaveAttribute('src', 'https://cdn.example.com/video.mp4');
    expect(video).not.toHaveAttribute('controls');
    expect(screen.getByRole('button', { name: 'Reproduzir' })).toBeInTheDocument();
    expect(container.querySelector('[aria-label="Volume"]')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Tela cheia' }));
    expect(screen.getByRole('button', { name: 'Fechar' })).toBeInTheDocument();
  });

  it('renders a direct audio embed with its own player', () => {
    const { container } = render(<LinkPreview embed={{ kind: 'audio', url: 'https://cdn.example.com/audio.mp3' }} />);

    const audio = container.querySelector('audio');
    expect(audio).toHaveAttribute('src', 'https://cdn.example.com/audio.mp3');
    expect(audio).not.toHaveAttribute('controls');
    expect(screen.getByRole('button', { name: 'Reproduzir' })).toBeInTheDocument();
    expect(container.querySelector('[aria-label="Volume"]')).toBeInTheDocument();
  });

  describe('direct image embed', () => {
    it('without fitContainer (chat message): uses the px width cap computed via JS', () => {
      const { container } = render(<LinkPreview embed={{ kind: 'image', url: 'https://cdn.example.com/foto.png' }} />);

      const img = container.querySelector('img');
      expect(img).toHaveAttribute('src', 'https://cdn.example.com/foto.png');
      // inline max-width in px — without it the image has no reliable width
      // ceiling inside the chat's flex container, which shrinks to fit its
      // own content (see the comment in chatSurfaceWidth.tsx).
      expect(img?.style.maxWidth).not.toBe('');
      expect(img?.className.split(/\s+/)).not.toContain('w-full');
    });

    it('with fitContainer (media grid): fills the real container via w-full, without the px cap', () => {
      const { container } = render(<LinkPreview embed={{ kind: 'image', url: 'https://cdn.example.com/foto.png' }} fitContainer />);

      const img = container.querySelector('img');
      // without this, the width cap meant for chat messages would win over
      // the class's max-w-full (same CSS property, inline always wins),
      // making the image wider than the masonry column and overlapping the
      // neighboring card — exactly the reported bug.
      expect(img?.style.maxWidth).toBe('');
      expect(img?.className.split(/\s+/)).toContain('w-full');
    });
  });
});

describe('LinkPreview — link preview only near the screen', () => {
  afterEach(() => { vi.unstubAllGlobals(); __resetLinkPreviewCacheForTests(); });

  it('does not fetch while the card is far away; fetches when it gets close', async () => {
    let fire: (visible: boolean) => void = () => {};
    vi.stubGlobal('IntersectionObserver', class {
      constructor(cb: IntersectionObserverCallback) { fire = (visible) => cb([{ isIntersecting: visible } as IntersectionObserverEntry], this as unknown as IntersectionObserver); }
      observe() {}
      disconnect() {}
    });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ url: 'https://ex.com', title: 'Exemplo', description: null, image: null, video: null, favicon: null, siteName: 'ex.com', themeColor: null }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    render(<LinkPreview embed={{ kind: 'link', url: 'https://ex.com' }} />);
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock).not.toHaveBeenCalled();

    act(() => fire(true));
    expect(await screen.findByText('Exemplo')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

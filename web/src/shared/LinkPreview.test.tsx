import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LinkPreview } from './LinkPreview';

describe('LinkPreview', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renderiza embed direto de video com o player proprio e lightbox interno', async () => {
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

  it('renderiza embed direto de audio com o player proprio', () => {
    const { container } = render(<LinkPreview embed={{ kind: 'audio', url: 'https://cdn.example.com/audio.mp3' }} />);

    const audio = container.querySelector('audio');
    expect(audio).toHaveAttribute('src', 'https://cdn.example.com/audio.mp3');
    expect(audio).not.toHaveAttribute('controls');
    expect(screen.getByRole('button', { name: 'Reproduzir' })).toBeInTheDocument();
    expect(container.querySelector('[aria-label="Volume"]')).toBeInTheDocument();
  });

  describe('embed de imagem direta', () => {
    it('sem fitContainer (mensagem de chat): usa o cap de largura em px calculado via JS', () => {
      const { container } = render(<LinkPreview embed={{ kind: 'image', url: 'https://cdn.example.com/foto.png' }} />);

      const img = container.querySelector('img');
      expect(img).toHaveAttribute('src', 'https://cdn.example.com/foto.png');
      // inline max-width em px — sem isso a imagem não tem nenhum teto de
      // largura confiável dentro do container flex do chat, que encolhe
      // pro próprio conteúdo (ver o comentário em chatSurfaceWidth.tsx).
      expect(img?.style.maxWidth).not.toBe('');
      expect(img?.className.split(/\s+/)).not.toContain('w-full');
    });

    it('com fitContainer (grid de mídias): preenche o container real via w-full, sem o cap em px', () => {
      const { container } = render(<LinkPreview embed={{ kind: 'image', url: 'https://cdn.example.com/foto.png' }} fitContainer />);

      const img = container.querySelector('img');
      // sem isso, o cap de largura pensado pra mensagem de chat "vencia" o
      // max-w-full da classe (mesma propriedade CSS, inline sempre ganha),
      // deixando a imagem mais larga que a coluna da masonry e
      // sobrepondo o card vizinho — exatamente o bug relatado.
      expect(img?.style.maxWidth).toBe('');
      expect(img?.className.split(/\s+/)).toContain('w-full');
    });
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatAttachment } from './ChatAttachment';

describe('ChatAttachment', () => {
  afterEach(() => {
    vi.restoreAllMocks();
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

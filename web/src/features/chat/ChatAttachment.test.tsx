import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChatAttachment } from './ChatAttachment';

describe('ChatAttachment', () => {
  it('renderiza upload de video com o player proprio', () => {
    const { container } = render(<ChatAttachment attachment={{ id: 'video-id', name: 'clip.mp4', mime: 'video/mp4', size: 123 }} />);

    const video = container.querySelector('video');
    expect(video).toHaveAttribute('src', '/uploads/video-id');
    expect(video).not.toHaveAttribute('controls');
    expect(screen.getByRole('button', { name: 'Reproduzir' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tela cheia' })).toBeInTheDocument();
  });

  it('renderiza upload de audio com o player proprio', () => {
    const { container } = render(<ChatAttachment attachment={{ id: 'audio-id', name: 'voz.mp3', mime: 'audio/mpeg', size: 456 }} />);

    const audio = container.querySelector('audio');
    expect(audio).toHaveAttribute('src', '/uploads/audio-id');
    expect(audio).not.toHaveAttribute('controls');
    expect(screen.getByText('voz.mp3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reproduzir' })).toBeInTheDocument();
  });
});

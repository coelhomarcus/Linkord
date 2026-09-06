import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRoom } from '../../test/roomContextFixture';
import { Stage } from './Stage';

const categories = [{
  id: 'calls',
  name: 'Chamadas',
  channels: [{ id: 'voice-1', name: 'Geral', type: 'voice' as const }],
}];

describe('Stage — estados de entrada na chamada', () => {
  it('mostra progresso e permite cancelar uma entrada pendente', async () => {
    const user = userEvent.setup();
    const cancelVoiceJoin = vi.fn(async () => {});
    const onExitVoice = vi.fn();
    renderWithRoom(
      <Stage allIds={[]} onBackMobile={vi.fn()} onExitVoice={onExitVoice} />,
      {
        categories,
        cancelVoiceJoin,
        voiceConnection: {
          status: 'joining', channelId: 'voice-1', mode: 'listen-only', joinMuted: true, error: null,
        },
      },
    );

    expect(screen.getByRole('status')).toHaveTextContent('Entrando em Geral');
    expect(screen.getByRole('status')).toHaveTextContent('somente ouvir');

    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(cancelVoiceJoin).toHaveBeenCalledOnce();
    expect(onExitVoice).toHaveBeenCalledOnce();
  });

  it('mostra o motivo da falha e oferece retry', async () => {
    const user = userEvent.setup();
    const retryVoiceChannel = vi.fn();
    renderWithRoom(
      <Stage allIds={[]} onBackMobile={vi.fn()} onExitVoice={vi.fn()} />,
      {
        categories,
        retryVoiceChannel,
        voiceConnection: {
          status: 'failed', channelId: 'voice-1', mode: 'voice', joinMuted: true, error: 'Servidor indisponivel.',
        },
      },
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Servidor indisponivel.');
    await user.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(retryVoiceChannel).toHaveBeenCalledOnce();
  });

  it('nao deixa a tela preta sem explicacao quando nao ha chamada ativa', () => {
    renderWithRoom(<Stage allIds={[]} onBackMobile={vi.fn()} onExitVoice={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Nenhuma chamada ativa' })).toBeInTheDocument();
  });
});

import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRoom } from '../../test/roomContextFixture';
import { initialRoomState } from '../../state/roomReducer';
import { ChatMessageList } from './ChatMessageList';
import type { ChatMessage } from '../../types/protocol';

const ownMessage: ChatMessage = {
  msgId: 41,
  channelId: 'text-1',
  id: 'account-me',
  name: 'Eu',
  avatar: '',
  text: 'mensagem que posso apagar',
  ts: Date.now(),
};

const userState = {
  ...initialRoomState,
  joined: true,
  me: {
    ...initialRoomState.me,
    id: 'connection-me',
    userId: 'account-me',
    name: 'Eu',
  },
};

describe('ChatMessageList — exclusao pelo autor', () => {
  it('permite apagar a propria mensagem somente depois da confirmacao', async () => {
    const user = userEvent.setup();
    const deleteChatMessage = vi.fn();
    renderWithRoom(<ChatMessageList channelId="text-1" onReply={vi.fn()} />, {
      state: userState,
      messagesByChannel: new Map([['text-1', [ownMessage]]]),
      deleteChatMessage,
    });

    await user.click(screen.getByRole('button', { name: 'Acoes da mensagem' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Apagar' }));

    expect(deleteChatMessage).not.toHaveBeenCalled();
    expect(await screen.findByRole('heading', { name: 'Apagar mensagem' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Apagar' }));
    expect(deleteChatMessage).toHaveBeenCalledWith(41);
  });

  it('nao oferece apagar a mensagem de outra pessoa para usuario comum', async () => {
    const user = userEvent.setup();
    renderWithRoom(<ChatMessageList channelId="text-1" onReply={vi.fn()} />, {
      state: userState,
      messagesByChannel: new Map([['text-1', [{ ...ownMessage, msgId: 42, id: 'other-account', name: 'Outra pessoa' }]]]),
    });

    await user.click(screen.getByRole('button', { name: 'Acoes da mensagem' }));
    expect(screen.queryByRole('menuitem', { name: 'Apagar' })).not.toBeInTheDocument();
  });
});

describe('ChatMessageList — mensagens pendentes/com falha (envio otimista)', () => {
  it('mostra "Enviando..." e esconde as acoes de uma mensagem ainda sem confirmacao do servidor', () => {
    renderWithRoom(<ChatMessageList channelId="text-1" onReply={vi.fn()} />, {
      state: userState,
      messagesByChannel: new Map([['text-1', [{ ...ownMessage, msgId: -1, clientId: 'c1', pending: 'sending' }]]]),
    });

    expect(screen.getByText('Enviando...')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Acoes da mensagem' })).not.toBeInTheDocument();
  });

  it('mensagem com falha oferece Tentar novamente e Descartar, chamando com channelId/clientId corretos', async () => {
    const user = userEvent.setup();
    const retryChatMessage = vi.fn();
    const discardFailedChatMessage = vi.fn();
    renderWithRoom(<ChatMessageList channelId="text-1" onReply={vi.fn()} />, {
      state: userState,
      messagesByChannel: new Map([['text-1', [{ ...ownMessage, msgId: -1, clientId: 'c1', pending: 'failed' }]]]),
      retryChatMessage,
      discardFailedChatMessage,
    });

    expect(screen.getByText('Falha ao enviar')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Acoes da mensagem' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(retryChatMessage).toHaveBeenCalledWith('text-1', 'c1');

    await user.click(screen.getByRole('button', { name: 'Descartar' }));
    expect(discardFailedChatMessage).toHaveBeenCalledWith('text-1', 'c1');
  });
});

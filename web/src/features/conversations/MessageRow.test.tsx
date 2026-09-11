import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { initialRoomState } from '../../state/roomReducer';
import { renderWithRoom } from '../../test/roomContextFixture';
import { MessageRow } from './MessageRow';
import type { ChatMessage } from '../../types/protocol';

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    msgId: 1,
    conversationId: 'conv-1',
    id: 'user-2',
    name: 'Fulana',
    avatar: '',
    text: 'Oi, tudo bem?',
    ts: Date.now(),
    ...overrides,
  };
}

const noop = () => {};

describe('MessageRow', () => {
  it('mostra avatar e nome quando showHeader, sem alinhar a mensagem a direita', () => {
    const message = makeMessage();
    renderWithRoom(
      <MessageRow
        message={message}
        showHeader
        highlighted={false}
        allUsers={new Map()}
        mentionLookup={new Map()}
        onOpenProfile={noop}
        onReply={noop}
        onJumpTo={noop}
      />
    );

    expect(screen.getByRole('button', { name: 'Fulana' })).toBeInTheDocument();
    expect(screen.getByText('Oi, tudo bem?')).toBeInTheDocument();
    const row = document.querySelector('[data-message-id="1"]');
    expect(row).not.toBeNull();
    expect(row?.className).not.toMatch(/justify-end/);
  });

  it('agrupa mensagens seguidas do mesmo autor sem repetir nome/avatar', () => {
    const message = makeMessage({ msgId: 2 });
    renderWithRoom(
      <MessageRow
        message={message}
        showHeader={false}
        highlighted={false}
        allUsers={new Map()}
        mentionLookup={new Map()}
        onOpenProfile={noop}
        onReply={noop}
        onJumpTo={noop}
      />
    );

    expect(screen.queryByRole('button', { name: 'Fulana' })).not.toBeInTheDocument();
    expect(screen.getByText('Oi, tudo bem?')).toBeInTheDocument();
  });

  it('toolbar de hover mostra editar/apagar so quando a mensagem e minha', async () => {
    const user = userEvent.setup();
    const deleteChatMessage = vi.fn();
    const message = makeMessage({ id: 'user-1' });
    const state = { ...initialRoomState, me: { ...initialRoomState.me, userId: 'user-1' } };

    renderWithRoom(
      <MessageRow
        message={message}
        showHeader
        highlighted={false}
        allUsers={new Map()}
        mentionLookup={new Map()}
        onOpenProfile={noop}
        onReply={noop}
        onJumpTo={noop}
      />,
      { state, deleteChatMessage }
    );

    expect(screen.getByRole('button', { name: 'Editar' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Apagar' }));
    expect(deleteChatMessage).toHaveBeenCalledWith(1);
  });

  it('clicar em responder chama onReply', async () => {
    const user = userEvent.setup();
    const onReply = vi.fn();
    renderWithRoom(
      <MessageRow
        message={makeMessage()}
        showHeader
        highlighted={false}
        allUsers={new Map()}
        mentionLookup={new Map()}
        onOpenProfile={noop}
        onReply={onReply}
        onJumpTo={noop}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Responder' }));
    expect(onReply).toHaveBeenCalledTimes(1);
  });
});

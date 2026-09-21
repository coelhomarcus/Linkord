import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { initialRoomState } from '@/state/roomReducer';
import { renderWithRoom } from '@tests/fixtures/roomContextFixture';
import { MessageRow } from '@/features/chat/MessageRow';
import type { ChatMessage, PublicUser } from '@/shared/types/protocol';

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

describe('MessageRow — referência de resposta', () => {
  const marcus: PublicUser = { id: 'user-marcus', username: 'marcus', displayName: 'Marcus', avatar: '', avatarColor: 'blurple', banner: '', bio: '', profileLinks: [], role: 'user' };

  it('mostra "@Nome" e o avatar de quem foi respondido', () => {
    const message = makeMessage({ replyTo: { msgId: 1, authorId: 'user-marcus', text: 'tacada.mp4' } });
    renderWithRoom(
      <MessageRow message={message} showHeader highlighted={false} allUsers={new Map([['user-marcus', marcus]])} mentionLookup={new Map()} onOpenProfile={noop} onReply={noop} onJumpTo={noop} />
    );

    const replyButton = screen.getByRole('button', { name: /@Marcus/ });
    expect(replyButton).toHaveTextContent('@Marcus');
    expect(replyButton.querySelector('[data-slot="avatar"]')).not.toBeNull();
  });

  it('autor apagado: sem "@" (só o rótulo padrão), mas ainda mostra um avatar-placeholder', () => {
    const message = makeMessage({ replyTo: { msgId: 1, authorId: 'user-sumiu', text: 'oi' } });
    renderWithRoom(
      <MessageRow message={message} showHeader highlighted={false} allUsers={new Map()} mentionLookup={new Map()} onOpenProfile={noop} onReply={noop} onJumpTo={noop} />
    );

    const replyButton = screen.getByRole('button', { name: /Usuário apagado/ });
    expect(replyButton).not.toHaveTextContent('@Usuário');
    expect(replyButton.querySelector('[data-slot="avatar"]')).not.toBeNull();
  });

  it('clicar na referência chama onJumpTo com o msgId original', async () => {
    const user = userEvent.setup();
    const onJumpTo = vi.fn();
    const message = makeMessage({ replyTo: { msgId: 42, authorId: 'user-marcus', text: 'oi' } });
    renderWithRoom(
      <MessageRow message={message} showHeader highlighted={false} allUsers={new Map([['user-marcus', marcus]])} mentionLookup={new Map()} onOpenProfile={noop} onReply={noop} onJumpTo={onJumpTo} />
    );

    await user.click(screen.getByRole('button', { name: /@Marcus/ }));

    expect(onJumpTo).toHaveBeenCalledWith(42);
  });
});

describe('MessageRow — reações rápidas', () => {
  it('abrir "Reagir" mostra o conjunto rápido, sem montar o picker completo', async () => {
    const user = userEvent.setup();
    renderWithRoom(
      <MessageRow message={makeMessage()} showHeader highlighted={false} allUsers={new Map()} mentionLookup={new Map()} onOpenProfile={noop} onReply={noop} onJumpTo={noop} />
    );

    await user.click(screen.getAllByRole('button', { name: 'Reagir' })[0]!);

    expect(screen.getByRole('button', { name: 'Reagir com 👍' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mais emojis' })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Buscar emoji…')).not.toBeInTheDocument();
  });

  it('clicar num emoji rápido reage direto e fecha o popover', async () => {
    const user = userEvent.setup();
    const reactToChatMessage = vi.fn();
    renderWithRoom(
      <MessageRow message={makeMessage()} showHeader highlighted={false} allUsers={new Map()} mentionLookup={new Map()} onOpenProfile={noop} onReply={noop} onJumpTo={noop} />,
      { reactToChatMessage }
    );

    await user.click(screen.getAllByRole('button', { name: 'Reagir' })[0]!);
    await user.click(screen.getByRole('button', { name: 'Reagir com 👍' }));

    expect(reactToChatMessage).toHaveBeenCalledWith(1, '👍');
    expect(screen.queryByRole('button', { name: 'Mais emojis' })).not.toBeInTheDocument();
  });

  it('clicar em "+" troca pro picker completo (busca de emoji)', async () => {
    const user = userEvent.setup();
    renderWithRoom(
      <MessageRow message={makeMessage()} showHeader highlighted={false} allUsers={new Map()} mentionLookup={new Map()} onOpenProfile={noop} onReply={noop} onJumpTo={noop} />
    );

    await user.click(screen.getAllByRole('button', { name: 'Reagir' })[0]!);
    await user.click(screen.getByRole('button', { name: 'Mais emojis' }));

    expect(await screen.findByPlaceholderText('Buscar emoji…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reagir com 👍' })).not.toBeInTheDocument();
  });
});

describe('MessageRow — cartão de convite', () => {
  const inviteMessage = () => makeMessage({
    kind: 'group_invite', text: '',
    invitation: {
      id: 'inv', status: 'pending', groupId: 'g', groupTitle: 'Squad', groupAvatar: '', memberCount: 2,
      inviterId: 'user-1', inviteeId: 'user-2', expiresAt: Date.now() + 1e6, version: 1,
    },
  });

  it('renderiza o card e nao oferece responder, editar nem reagir (só apagar)', () => {
    const state = { ...initialRoomState, me: { ...initialRoomState.me, userId: 'user-2' } };
    renderWithRoom(
      <MessageRow message={inviteMessage()} showHeader highlighted={false} allUsers={new Map()} mentionLookup={new Map()} onOpenProfile={noop} onReply={noop} onJumpTo={noop} />,
      { state, editingMsgId: 1 },
    );
    expect(screen.getByText('Squad')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Responder' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Editar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reagir' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Apagar' }).length).toBeGreaterThan(0);
  });
});

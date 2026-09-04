import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRoom } from '../../test/roomContextFixture';
import { initialRoomState } from '../../state/roomReducer';
import { ChatComposer } from './ChatComposer';
import type { PublicUser } from '../../types/protocol';

// composer precisa de state.joined pra nao ficar desabilitado (ver
// `disabled` em ChatComposer.tsx).
const joinedState = { ...initialRoomState, joined: true };

const allUsers = new Map<string, PublicUser>([
  ['u1', { id: 'u1', username: 'Luanzera', avatar: '', role: 'user' }],
  ['u2', { id: 'u2', username: 'Lune', avatar: '', role: 'admin' }],
  ['u3', { id: 'u3', username: 'mamaepapai', avatar: '', role: 'user' }],
]);

describe('ChatComposer — @mencoes', () => {
  it('digitar "@lu" sugere so quem comeca com "lu" (case-insensitive), nao quem so contem', async () => {
    const user = userEvent.setup();
    renderWithRoom(<ChatComposer channelId="c1" />, { state: joinedState, allUsers });

    await user.type(screen.getByPlaceholderText('Mandar mensagem'), 'oi @lu');

    expect(screen.getByText('Luanzera')).toBeInTheDocument();
    expect(screen.getByText('Lune')).toBeInTheDocument();
    expect(screen.queryByText('mamaepapai')).not.toBeInTheDocument();
  });

  it('clicar numa sugestao insere "@username " no lugar do "@query" e fecha o dropdown', async () => {
    const user = userEvent.setup();
    renderWithRoom(<ChatComposer channelId="c1" />, { state: joinedState, allUsers });

    const textarea = screen.getByPlaceholderText('Mandar mensagem') as HTMLTextAreaElement;
    await user.type(textarea, 'oi @lun');
    await user.click(screen.getByText('Lune'));

    expect(textarea).toHaveValue('oi @Lune ');
    expect(screen.queryByText('Luanzera')).not.toBeInTheDocument();
  });

  it('Enter com o dropdown aberto escolhe a sugestao em vez de enviar a mensagem', async () => {
    const sendChatMessage = vi.fn();
    const user = userEvent.setup();
    renderWithRoom(<ChatComposer channelId="c1" />, { state: joinedState, allUsers, sendChatMessage });

    const textarea = screen.getByPlaceholderText('Mandar mensagem') as HTMLTextAreaElement;
    await user.type(textarea, '@lune{Enter}');

    expect(textarea).toHaveValue('@Lune ');
    expect(sendChatMessage).not.toHaveBeenCalled();
  });

  it('Escape fecha o dropdown sem mexer no texto', async () => {
    const user = userEvent.setup();
    renderWithRoom(<ChatComposer channelId="c1" />, { state: joinedState, allUsers });

    const textarea = screen.getByPlaceholderText('Mandar mensagem') as HTMLTextAreaElement;
    await user.type(textarea, 'oi @lu{Escape}');

    expect(screen.queryByText('Luanzera')).not.toBeInTheDocument();
    expect(textarea).toHaveValue('oi @lu');
  });

  it('"@" no meio de uma palavra (ex: e-mail) nao abre o dropdown', async () => {
    const user = userEvent.setup();
    renderWithRoom(<ChatComposer channelId="c1" />, { state: joinedState, allUsers });

    await user.type(screen.getByPlaceholderText('Mandar mensagem'), 'fulano@lu');

    expect(screen.queryByText('Luanzera')).not.toBeInTheDocument();
  });

  it('enviar mensagem sem @ continua funcionando normalmente', async () => {
    const sendChatMessage = vi.fn();
    const user = userEvent.setup();
    renderWithRoom(<ChatComposer channelId="c1" />, { state: joinedState, allUsers, sendChatMessage });

    await user.type(screen.getByPlaceholderText('Mandar mensagem'), 'oi tudo bem{Enter}');

    expect(sendChatMessage).toHaveBeenCalledWith('c1', 'oi tudo bem', undefined);
  });
});

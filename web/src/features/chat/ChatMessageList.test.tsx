import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithRoom } from '../../test/roomContextFixture';
import { initialRoomState } from '../../state/roomReducer';
import { ChatMessageList } from './ChatMessageList';
import type { ChatMessage, PublicUser } from '../../types/protocol';

vi.mock('../../shared/Avatar', () => ({
  Avatar: ({ name, avatar }: { name: string; avatar: string }) => (
    <span data-testid="avatar" data-avatar={avatar}>{name}</span>
  ),
}));

const state = {
  ...initialRoomState,
  joined: true,
  me: { ...initialRoomState.me, userId: 'me', role: 'user' as const },
};

describe('ChatMessageList', () => {
  it('renderiza nome e avatar atuais do usuario, nao os dados do payload da mensagem', () => {
    const message: ChatMessage = {
      msgId: 1,
      channelId: 'c1',
      id: 'u1',
      name: 'Nome Antigo',
      avatar: '/uploads/avatar-antigo',
      text: 'mensagem antiga',
      ts: Date.UTC(2026, 0, 1, 12, 0),
    };
    const currentUser: PublicUser = {
      id: 'u1',
      username: 'fulana',
      displayName: 'Nome Atual',
      avatar: '/uploads/avatar-atual',
      avatarColor: 'green',
      role: 'user',
    };

    renderWithRoom(
      <ChatMessageList channelId="c1" onReply={() => {}} />,
      {
        state,
        allUsers: new Map([['u1', currentUser]]),
        messagesByChannel: new Map([['c1', [message]]]),
      }
    );

    expect(screen.getAllByText('Nome Atual')).toHaveLength(2);
    expect(screen.queryByText('Nome Antigo')).not.toBeInTheDocument();
    expect(screen.getByTestId('avatar')).toHaveAttribute('data-avatar', '/uploads/avatar-atual');
  });
});

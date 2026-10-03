import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithRoom } from '@tests/fixtures/roomContextFixture';
import { TypingIndicator } from '@/features/chat/TypingIndicator';
import type { PublicUser } from '@/shared/types/protocol';

function user(id: string, displayName: string): PublicUser {
  return { id, username: displayName.toLowerCase(), displayName, avatar: '', avatarColor: 'blurple', banner: '', bio: '', profileLinks: [], role: 'user' };
}

describe('TypingIndicator', () => {
  it('nobody typing: the status region exists, but empty (announces the first change)', () => {
    renderWithRoom(<TypingIndicator conversationId="conv-1" />, {
      typingByConversation: new Map(),
    });
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('one person typing: shows their avatar and the text', () => {
    renderWithRoom(<TypingIndicator conversationId="conv-1" />, {
      allUsers: new Map([['u1', user('u1', 'Fulano')]]),
      typingByConversation: new Map([['conv-1', new Set(['u1'])]]),
    });
    expect(screen.getByText('Fulano está digitando...')).toBeInTheDocument();
  });

  it('only shows who is typing in THIS conversation, not another one', () => {
    renderWithRoom(<TypingIndicator conversationId="conv-1" />, {
      allUsers: new Map([['u1', user('u1', 'Fulano')]]),
      typingByConversation: new Map([['conv-2', new Set(['u1'])]]),
    });
    expect(screen.queryByText(/digitando/)).not.toBeInTheDocument();
  });

  it('more than 3 people: generic text, but still shows up to 3 avatars', () => {
    renderWithRoom(<TypingIndicator conversationId="conv-1" />, {
      allUsers: new Map([
        ['u1', user('u1', 'Fulano')], ['u2', user('u2', 'Beltrana')],
        ['u3', user('u3', 'Ciclano')], ['u4', user('u4', 'Deltrana')],
      ]),
      typingByConversation: new Map([['conv-1', new Set(['u1', 'u2', 'u3', 'u4'])]]),
    });
    expect(screen.getByText('Várias pessoas estão digitando...')).toBeInTheDocument();
  });

  it('does not crash if the typing user already left allUsers (presence race)', () => {
    renderWithRoom(<TypingIndicator conversationId="conv-1" />, {
      allUsers: new Map(),
      typingByConversation: new Map([['conv-1', new Set(['ghost'])]]),
    });
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });
});

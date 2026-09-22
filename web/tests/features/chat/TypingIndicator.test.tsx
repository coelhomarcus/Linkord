import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithRoom } from '@tests/fixtures/roomContextFixture';
import { TypingIndicator } from '@/features/chat/TypingIndicator';
import type { PublicUser } from '@/shared/types/protocol';

function user(id: string, displayName: string): PublicUser {
  return { id, username: displayName.toLowerCase(), displayName, avatar: '', avatarColor: 'blurple', banner: '', bio: '', profileLinks: [], role: 'user' };
}

describe('TypingIndicator', () => {
  it('ninguem digitando: nao renderiza nada', () => {
    const { container } = renderWithRoom(<TypingIndicator conversationId="conv-1" />, {
      typingByConversation: new Map(),
    });
    expect(container).toBeEmptyDOMElement();
  });

  it('uma pessoa digitando: mostra o avatar dela e o texto', () => {
    renderWithRoom(<TypingIndicator conversationId="conv-1" />, {
      allUsers: new Map([['u1', user('u1', 'Fulano')]]),
      typingByConversation: new Map([['conv-1', new Set(['u1'])]]),
    });
    expect(screen.getByText('Fulano está digitando...')).toBeInTheDocument();
  });

  it('so mostra quem digita NESSA conversa, nao em outra', () => {
    renderWithRoom(<TypingIndicator conversationId="conv-1" />, {
      allUsers: new Map([['u1', user('u1', 'Fulano')]]),
      typingByConversation: new Map([['conv-2', new Set(['u1'])]]),
    });
    expect(screen.queryByText(/digitando/)).not.toBeInTheDocument();
  });

  it('mais de 3 pessoas: texto generico, mas ainda mostra ate 3 avatares', () => {
    renderWithRoom(<TypingIndicator conversationId="conv-1" />, {
      allUsers: new Map([
        ['u1', user('u1', 'Fulano')], ['u2', user('u2', 'Beltrana')],
        ['u3', user('u3', 'Ciclano')], ['u4', user('u4', 'Deltrana')],
      ]),
      typingByConversation: new Map([['conv-1', new Set(['u1', 'u2', 'u3', 'u4'])]]),
    });
    expect(screen.getByText('Várias pessoas estão digitando...')).toBeInTheDocument();
  });

  it('nao trava se o usuario que digita ja saiu do allUsers (race de presenca)', () => {
    const { container } = renderWithRoom(<TypingIndicator conversationId="conv-1" />, {
      allUsers: new Map(),
      typingByConversation: new Map([['conv-1', new Set(['ghost'])]]),
    });
    expect(container).toBeEmptyDOMElement();
  });
});

import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderSocial } from '@tests/fixtures/socialFixture';
import { AnimatedSidebarProvider } from '@/shared/ui/motion/animated-sidebar';
import { ConversationSidebar } from '@/features/conversations/ConversationSidebar';
import { initialRoomState } from '@/state/roomReducer';
import type { Conversation, ChatMessage, PublicUser } from '@/shared/types/protocol';

const meState = { ...initialRoomState, me: { ...initialRoomState.me, id: 'c', userId: 'me', name: 'fulana', displayName: 'Fulana' } };
const bea: PublicUser = { id: 'u-bea', username: 'bea', displayName: 'Bea', avatar: '', avatarColor: 'green', banner: '', bio: '', profileLinks: [], role: 'user' as const };

function directConversation(): Conversation {
  return {
    id: 'conv-dm', type: 'direct', title: '', avatar: '', createdBy: null, memberIds: ['me', 'u-bea'],
    lastMessageAt: Date.now(), createdAt: 0, updatedAt: 0, pinnedAt: null, myRole: 'member', ownerId: null, memberCount: 2,
  };
}

function groupConversation(): Conversation {
  return {
    id: 'conv-group', type: 'group', title: 'os xerecas', avatar: '', createdBy: 'me', memberIds: ['me', 'u-bea'],
    lastMessageAt: null, createdAt: 0, updatedAt: 0, pinnedAt: null, myRole: 'owner', ownerId: 'me', memberCount: 2,
  };
}

function lastMessage(conversationId: string): ChatMessage {
  return { msgId: 1, conversationId, id: 'u-bea', name: 'Bea', avatar: '', text: 'oi, tudo bem?', ts: Date.now() };
}

function renderSidebar() {
  const dm = directConversation();
  const group = groupConversation();
  return renderSocial(
    <AnimatedSidebarProvider open onOpenChange={vi.fn()} openMobile={false} onOpenMobileChange={vi.fn()}>
      <ConversationSidebar onOpenPalette={vi.fn()} mobileRail={null} />
    </AnimatedSidebarProvider>,
    {
      room: {
        state: meState,
        conversations: [dm, group],
        allUsers: new Map([['u-bea', bea]]),
        messagesByConversation: new Map([['conv-dm', [lastMessage('conv-dm')]]]),
      },
      path: '/app/conversations',
    },
  );
}

describe('ConversationSidebar — linha da conversa so mostra o nome (sem @, sem previa, sem "membros")', () => {
  it('DM com mensagem: mostra so o nome de exibição, nao a previa da ultima mensagem', () => {
    renderSidebar();
    expect(screen.getByText('Bea')).toBeInTheDocument();
    expect(screen.queryByText(/tudo bem/)).not.toBeInTheDocument();
    expect(screen.queryByText(/@bea/)).not.toBeInTheDocument();
  });

  it('grupo sem mensagem: mostra so o titulo, nao a contagem de membros', () => {
    renderSidebar();
    expect(screen.getByText('os xerecas')).toBeInTheDocument();
    expect(screen.queryByText(/membros/)).not.toBeInTheDocument();
  });
});

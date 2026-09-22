import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderSocial } from '@tests/fixtures/socialFixture';
import { AnimatedSidebarProvider } from '@/shared/ui/motion/animated-sidebar';
import { ConversationSidebar } from '@/features/conversations/ConversationSidebar';
import { initialRoomState } from '@/state/roomReducer';
import type { Conversation, ChatMessage, Participant, PublicUser } from '@/shared/types/protocol';

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

function callParticipant(): Participant {
  return {
    id: 'p-bea', userId: 'u-bea',
    name: 'bea', displayName: 'Bea', avatar: '', avatarPoster: '', avatarColor: 'green', banner: '', bannerPoster: '', bio: '', profileLinks: [],
    role: 'user', deafened: false, callConversationId: 'conv-group', micActivated: true, micMuted: false, cameraOn: false,
    sharing: false, speaking: false,
  };
}

function renderSidebar(overrides: { activeCallConversationId?: string | null; participants?: Map<string, Participant> } = {}) {
  const dm = directConversation();
  const group = groupConversation();
  return renderSocial(
    <AnimatedSidebarProvider open onOpenChange={vi.fn()} openMobile={false} onOpenMobileChange={vi.fn()}>
      <ConversationSidebar onOpenPalette={vi.fn()} mobileRail={null} />
    </AnimatedSidebarProvider>,
    {
      room: {
        state: { ...meState, participants: overrides.participants ?? new Map() },
        conversations: [dm, group],
        allUsers: new Map([['u-bea', bea]]),
        messagesByConversation: new Map([['conv-dm', [lastMessage('conv-dm')]]]),
        activeCallConversationId: overrides.activeCallConversationId ?? null,
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

  it('nao mostra mais o horario da ultima mensagem — so avatar e nome, igual Discord', () => {
    renderSidebar();
    // 17:32-shaped or similar — any DM/group row's time text is gone entirely.
    expect(screen.queryByText(/^\d{1,2}:\d{2}$/)).not.toBeInTheDocument();
  });

  it('sem chamada ativa: a linha da conversa tem so uma linha (nome), nada embaixo', () => {
    renderSidebar();
    const title = screen.getByText('os xerecas');
    // title's own wrapping <span> has no sibling below it (no second line) —
    // the row only grows a second line when there's a call to show.
    expect(title.parentElement?.children).toHaveLength(1);
  });

  it('grupo com chamada ativa: aparece uma segunda linha com quem esta na chamada, no lugar onde era a data', () => {
    const participants = new Map([['p-bea', callParticipant()]]);
    renderSidebar({ participants });
    const title = screen.getByText('os xerecas');
    // title's row now has a sibling block below it — the call indicator, in
    // the exact slot the removed timestamp used to occupy.
    expect(title.parentElement?.children).toHaveLength(2);
    expect(title.nextElementSibling).not.toBeNull();
    expect(title.nextElementSibling?.textContent).not.toContain('os xerecas');
  });
});

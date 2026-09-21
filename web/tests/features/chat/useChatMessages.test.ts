import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useChatMessages } from '@/features/chat/useChatMessages';
import type { ChatMessage, InvitationCard } from '@/shared/types/protocol';

const card = (over: Partial<InvitationCard> = {}): InvitationCard => ({
  id: 'inv-1', status: 'pending', groupId: 'g', groupTitle: 'Grupo', groupAvatar: '', memberCount: 2,
  inviterId: 'a', inviteeId: 'b', version: 1, ...over,
});
const message = (msgId: number, over: Partial<ChatMessage> = {}): ChatMessage => ({
  msgId, conversationId: 'dm', id: 'a', name: 'A', avatar: '', text: '', ts: 1, ...over,
});

function setup() {
  const ref = <T,>(current: T) => ({ current });
  return renderHook(() => useChatMessages({
    sendWs: vi.fn(), activeConversationIdRef: ref<string | null>('dm'), setActiveConversation: vi.fn(),
    conversationsRef: ref([]), allUsersRef: ref(new Map()), myUserIdRef: ref<string | null>('b'), myUsernameRef: ref<string | null>('b'),
    activeViewRef: ref<'chat' | 'call'>('chat'), clearTypingEntry: vi.fn(),
  }));
}

describe('useChatMessages — invitation-updated', () => {
  it('atualiza so o card com o mesmo id, em qualquer conversa', () => {
    const { result } = setup();
    act(() => result.current.onConversationHistory({
      t: 'conversation-history', conversationId: 'dm', hasMore: false,
      messages: [message(1, { text: 'oi' }), message(2, { kind: 'group_invite', invitation: card() }), message(3, { kind: 'group_invite', invitation: card({ id: 'inv-2' }) })],
    }));
    act(() => result.current.onInvitationUpdated({ t: 'invitation-updated', invitation: card({ status: 'accepted', version: 2 }) }));

    const list = result.current.messagesByConversation.get('dm')!;
    expect(list[0].invitation).toBeUndefined();
    expect(list[1].invitation).toMatchObject({ status: 'accepted', version: 2 });
    expect(list[2].invitation).toMatchObject({ id: 'inv-2', status: 'pending' });
  });

  it('nao recria o estado quando nenhum card corresponde', () => {
    const { result } = setup();
    act(() => result.current.onConversationHistory({ t: 'conversation-history', conversationId: 'dm', hasMore: false, messages: [message(1)] }));
    const before = result.current.messagesByConversation;
    act(() => result.current.onInvitationUpdated({ t: 'invitation-updated', invitation: card({ id: 'outro' }) }));
    expect(result.current.messagesByConversation).toBe(before);
  });
});

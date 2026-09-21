import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { Conversation } from '@/shared/types/protocol';
import { useConversationsList } from '@/features/conversations/useConversationsList';

const conv = (id: string, over: Partial<Conversation> = {}): Conversation => ({
  id, type: 'direct', title: '', avatar: '', createdBy: null, memberIds: ['me', 'peer'],
  lastMessageAt: null, createdAt: 1, updatedAt: 1, pinnedAt: null, myRole: 'member', ownerId: null, memberCount: 0, ...over,
});

describe('useConversationsList — conversation-updated', () => {
  it('atualiza uma conversa que o cliente ja tem', () => {
    const { result } = renderHook(() => useConversationsList(vi.fn()));
    act(() => result.current.setInitial([conv('a', { title: 'antigo' })]));
    act(() => result.current.onConversationUpdated({ t: 'conversation-updated', conversation: conv('a', { title: 'novo' }) }));
    expect(result.current.conversations.map((c) => c.title)).toEqual(['novo']);
  });

  it('um update de conversa DESCONHECIDA vira insercao — e assim que o destinatario de uma primeira DM a recebe', () => {
    const { result } = renderHook(() => useConversationsList(vi.fn()));
    act(() => result.current.setInitial([conv('a', { lastMessageAt: 1000 })]));
    act(() => result.current.onConversationUpdated({ t: 'conversation-updated', conversation: conv('nova-dm', { lastMessageAt: 2000 }) }));
    expect(result.current.conversations.map((c) => c.id)).toEqual(['nova-dm', 'a']);
  });
});

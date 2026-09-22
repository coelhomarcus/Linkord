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

describe('useConversationsList — conversation-opened/conversation-created respeitam o fixado', () => {
  it('abrir uma conversa nova (DM ou grupo recem-criado) nao empurra a fixada pra baixo', () => {
    // handleDirectOpen/handleGroupCreate on the server both send
    // 'conversation-opened' for a brand-new conversation the client never
    // had — reproduces exactly that: a pinned conversation already in the
    // list, then a new one arrives.
    const { result } = renderHook(() => useConversationsList(vi.fn()));
    act(() => result.current.setInitial([conv('fixada', { pinnedAt: 5000, lastMessageAt: 1000 })]));
    act(() => result.current.onConversationOpened(
      { t: 'conversation-opened', conversationId: 'nova', conversation: conv('nova', { lastMessageAt: 9999 }) },
      vi.fn(),
    ));
    expect(result.current.conversations.map((c) => c.id)).toEqual(['fixada', 'nova']);
  });

  it('reabrir uma conversa ja conhecida tambem mantem a fixada no topo', () => {
    const { result } = renderHook(() => useConversationsList(vi.fn()));
    act(() => result.current.setInitial([
      conv('fixada', { pinnedAt: 5000, lastMessageAt: 1000 }),
      conv('existente', { lastMessageAt: 2000 }),
    ]));
    act(() => result.current.onConversationOpened(
      { t: 'conversation-opened', conversationId: 'existente', conversation: conv('existente', { lastMessageAt: 9999 }) },
      vi.fn(),
    ));
    expect(result.current.conversations.map((c) => c.id)).toEqual(['fixada', 'existente']);
  });

  it('conversation-created tambem respeita o fixado', () => {
    const { result } = renderHook(() => useConversationsList(vi.fn()));
    act(() => result.current.setInitial([conv('fixada', { pinnedAt: 5000, lastMessageAt: 1000 })]));
    act(() => result.current.onConversationCreated({ t: 'conversation-created', conversation: conv('nova', { lastMessageAt: 9999 }) }));
    expect(result.current.conversations.map((c) => c.id)).toEqual(['fixada', 'nova']);
  });
});

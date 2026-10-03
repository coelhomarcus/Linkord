import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { Conversation } from '@/shared/types/protocol';
import { useConversationsList } from '@/features/conversations/useConversationsList';

const conv = (id: string, over: Partial<Conversation> = {}): Conversation => ({
  id, type: 'direct', title: '', avatar: '', createdBy: null, memberIds: ['me', 'peer'],
  lastMessageAt: null, createdAt: 1, updatedAt: 1, pinnedAt: null, myRole: 'member', ownerId: null, memberCount: 0, ...over,
});

describe('useConversationsList — conversation-updated', () => {
  it('updates a conversation the client already has', () => {
    const { result } = renderHook(() => useConversationsList(vi.fn()));
    act(() => result.current.setInitial([conv('a', { title: 'old' })]));
    act(() => result.current.onConversationUpdated({ t: 'conversation-updated', conversation: conv('a', { title: 'new' }) }));
    expect(result.current.conversations.map((c) => c.title)).toEqual(['new']);
  });

  it('an update for an UNKNOWN conversation becomes an insert — this is exactly how the recipient of a first DM gets it', () => {
    const { result } = renderHook(() => useConversationsList(vi.fn()));
    act(() => result.current.setInitial([conv('a', { lastMessageAt: 1000 })]));
    act(() => result.current.onConversationUpdated({ t: 'conversation-updated', conversation: conv('new-dm', { lastMessageAt: 2000 }) }));
    expect(result.current.conversations.map((c) => c.id)).toEqual(['new-dm', 'a']);
  });
});

describe('useConversationsList — conversation-opened/conversation-created respect the pinned item', () => {
  it('opening a new conversation (DM or freshly-created group) does not push the pinned one down', () => {
    // handleDirectOpen/handleGroupCreate on the server both send
    // 'conversation-opened' for a brand-new conversation the client never
    // had — reproduces exactly that: a pinned conversation already in the
    // list, then a new one arrives.
    const { result } = renderHook(() => useConversationsList(vi.fn()));
    act(() => result.current.setInitial([conv('pinned', { pinnedAt: 5000, lastMessageAt: 1000 })]));
    act(() => result.current.onConversationOpened(
      { t: 'conversation-opened', conversationId: 'new', conversation: conv('new', { lastMessageAt: 9999 }) },
      vi.fn(),
    ));
    expect(result.current.conversations.map((c) => c.id)).toEqual(['pinned', 'new']);
  });

  it('reopening an already-known conversation also keeps the pinned one on top', () => {
    const { result } = renderHook(() => useConversationsList(vi.fn()));
    act(() => result.current.setInitial([
      conv('pinned', { pinnedAt: 5000, lastMessageAt: 1000 }),
      conv('existing', { lastMessageAt: 2000 }),
    ]));
    act(() => result.current.onConversationOpened(
      { t: 'conversation-opened', conversationId: 'existing', conversation: conv('existing', { lastMessageAt: 9999 }) },
      vi.fn(),
    ));
    expect(result.current.conversations.map((c) => c.id)).toEqual(['pinned', 'existing']);
  });

  it('conversation-created also respects the pinned item', () => {
    const { result } = renderHook(() => useConversationsList(vi.fn()));
    act(() => result.current.setInitial([conv('pinned', { pinnedAt: 5000, lastMessageAt: 1000 })]));
    act(() => result.current.onConversationCreated({ t: 'conversation-created', conversation: conv('new', { lastMessageAt: 9999 }) }));
    expect(result.current.conversations.map((c) => c.id)).toEqual(['pinned', 'new']);
  });
});

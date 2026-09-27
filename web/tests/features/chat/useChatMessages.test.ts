import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useChatMessages } from '@/features/chat/useChatMessages';
import type { ChatMessage, InvitationCard } from '@/shared/types/protocol';

vi.mock('@/shared/sounds', () => ({ playSound: vi.fn() }));
vi.mock('@/shared/notifications', () => ({ notifyIncomingChatMessage: vi.fn() }));

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

describe('useChatMessages — nao lidas', () => {
  it('mensagem propria em outra conversa nao conta como nao lida; a de outra pessoa conta', () => {
    const { result } = setup();
    act(() => result.current.onChat({ t: 'chat', message: message(10, { conversationId: 'outra', id: 'b' }) }));
    expect(result.current.unreadByConversation.get('outra')).toBeUndefined();

    act(() => result.current.onChat({ t: 'chat', message: message(11, { conversationId: 'outra', id: 'a' }) }));
    expect(result.current.unreadByConversation.get('outra')).toBe(1);
  });
});

describe('useChatMessages — envio correlacionado', () => {
  function setupWith(sendWs = vi.fn(() => true)) {
    const ref = <T,>(current: T) => ({ current });
    const hook = renderHook(() => useChatMessages({
      sendWs, activeConversationIdRef: ref<string | null>('dm'), setActiveConversation: vi.fn(),
      conversationsRef: ref([]), allUsersRef: ref(new Map()), myUserIdRef: ref<string | null>('b'), myUsernameRef: ref<string | null>('b'),
      activeViewRef: ref<'chat' | 'call'>('chat'), clearTypingEntry: vi.fn(),
    }));
    return { ...hook, sendWs };
  }

  it('servidor antigo (sem protocolVersion): envia do jeito legado, sem chave', () => {
    const { result, sendWs } = setupWith();
    act(() => result.current.onWelcome(undefined));
    act(() => { result.current.sendChatMessage('dm', 'oi'); });
    expect(sendWs).toHaveBeenCalledWith({ t: 'chat', conversationId: 'dm', text: 'oi' });
    expect(result.current.pendingByConversation.size).toBe(0);
  });

  it('servidor 3+: envia pela outbox e a confirmacao entra no historico uma vez so', () => {
    const { result, sendWs } = setupWith();
    act(() => result.current.onWelcome(3));
    act(() => { result.current.sendChatMessage('dm', 'oi'); });
    const req = (sendWs.mock.calls.at(-1) as unknown as [{ requestId: string; clientMessageId: string }])[0];
    expect(result.current.pendingByConversation.get('dm')).toHaveLength(1);

    const confirmed = message(50, { text: 'oi', id: 'b', clientMessageId: req.clientMessageId });
    act(() => result.current.onChatSendResult({ t: 'chat-send-result', requestId: req.requestId, clientMessageId: req.clientMessageId, message: confirmed }));
    act(() => result.current.onChat({ t: 'chat', message: confirmed }));

    expect(result.current.messagesByConversation.get('dm')!.map((m) => m.msgId)).toEqual([50]);
    expect(result.current.pendingByConversation.get('dm')).toBeUndefined();
  });

  it('chat repetido nao duplica a mensagem nem a contagem de nao lidas', () => {
    const { result } = setupWith();
    const other = message(7, { conversationId: 'outra', id: 'a' });
    act(() => result.current.onChat({ t: 'chat', message: other }));
    act(() => result.current.onChat({ t: 'chat', message: other }));
    expect(result.current.messagesByConversation.get('outra')).toHaveLength(1);
    expect(result.current.unreadByConversation.get('outra')).toBe(1);
  });
});

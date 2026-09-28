import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { reactionKey, withPendingReactions } from '@/features/chat/reactionState';
import { useReactionIntents } from '@/features/chat/useReactionIntents';
import { MessageReactions } from '@/features/chat/MessageReactions';
import { ReactionParticipantsDialog } from '@/features/chat/ReactionParticipantsDialog';
import { initialRoomState } from '@/state/roomReducer';
import { renderWithRoom } from '@tests/fixtures/roomContextFixture';
import type { ChatMessage, PublicUser } from '@/shared/types/protocol';

describe('withPendingReactions', () => {
  it('so a participacao do proprio usuario muda; a dos outros fica', () => {
    const pending = new Map([[reactionKey(1, '👍'), true], [reactionKey(1, '🎉'), false], [reactionKey(2, '😂'), true]]);
    expect(withPendingReactions({ '👍': ['ana'], '🎉': ['me', 'bia'] }, 1, pending, 'me')).toEqual({ '👍': ['ana', 'me'], '🎉': ['bia'] });
  });

  it('remover a unica reacao some com o chip', () => {
    expect(withPendingReactions({ '👍': ['me'] }, 1, new Map([[reactionKey(1, '👍'), false]]), 'me')).toEqual({});
  });
});

describe('useReactionIntents', () => {
  function setup() {
    const resolvers: { msg: { present?: boolean }; resolve: () => void; reject: (e: Error) => void }[] = [];
    const request = vi.fn((msg: { present?: boolean }) => new Promise<void>((resolve, reject) => { resolvers.push({ msg, resolve, reject }); }));
    const onError = vi.fn();
    const hook = renderHook(() => useReactionIntents({ request: request as never, onError }));
    return { ...hook, request, resolvers, onError };
  }
  const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

  it('cliques rapidos convergem para a ultima intencao, sem corrida', async () => {
    const { result, request, resolvers } = setup();
    act(() => result.current.react(1, '👍', false));
    act(() => result.current.react(1, '👍', false));
    act(() => result.current.react(1, '👍', false));
    expect(request).toHaveBeenCalledTimes(1);
    expect(result.current.pendingReactions.get(reactionKey(1, '👍'))).toBe(true);

    resolvers[0]!.resolve();
    await flush();
    // the final intent (on) matched what was already sent
    expect(request).toHaveBeenCalledTimes(1);
    expect(result.current.pendingReactions.size).toBe(0);
  });

  it('mudou de ideia durante o envio: manda a intencao mais nova depois', async () => {
    const { result, request, resolvers } = setup();
    act(() => result.current.react(1, '👍', false));
    act(() => result.current.react(1, '👍', false));
    resolvers[0]!.resolve();
    await flush();
    expect(request).toHaveBeenCalledTimes(2);
    expect(resolvers[1]!.msg.present).toBe(false);
  });

  it('falha: descarta a intencao e avisa o motivo', async () => {
    const { result, resolvers, onError } = setup();
    act(() => result.current.react(7, '🎉', false));
    resolvers[0]!.reject(new Error('Sem permissão.'));
    await flush();
    expect(result.current.pendingReactions.size).toBe(0);
    expect(onError).toHaveBeenCalledWith(7, 'Sem permissão.');
  });
});

describe('MessageReactions', () => {
  const user = (id: string, displayName: string): PublicUser => ({ id, username: id, displayName, avatar: '', avatarColor: 'blurple', banner: '', bio: '', profileLinks: [], role: 'user' });
  const allUsers = new Map([['ana', user('ana', 'Ana')], ['bia', user('bia', 'Bia')]]);

  it('chip acessivel: pressionado quando e meu, rotulo com acao e nomes', () => {
    render(<MessageReactions reactions={{ '👍': ['ana', 'me'] }} myUserId="me" allUsers={allUsers} onToggle={() => {}} />);
    const chip = screen.getByRole('button', { name: /reação 👍/ });
    expect(chip).toHaveAttribute('aria-pressed', 'true');
    expect(chip).toHaveAccessibleName('Remover reação 👍 (2): Ana, Você');
  });

  const findTooltip = () => waitFor(() => {
    const el = document.querySelector('[data-slot="tooltip-content"]');
    if (!el) throw new Error('tooltip not open yet');
    return el;
  }, { timeout: 2000 });

  it('hover no chip mostra quem reagiu, com fallback para participante sem dados', async () => {
    const ue = userEvent.setup();
    render(<MessageReactions reactions={{ '🎉': ['bia', 'sumiu'] }} myUserId="me" allUsers={allUsers} onToggle={() => {}} />);
    await ue.hover(screen.getByRole('button', { name: /reação 🎉/ }));
    const tooltip = await findTooltip();
    expect(tooltip).toHaveTextContent('Bia e Participante indisponível reagiram');
  });

  it('foco no chip mostra o mesmo resumo, sem precisar de mouse', async () => {
    render(<MessageReactions reactions={{ '👍': ['ana', 'me'] }} myUserId="me" allUsers={allUsers} onToggle={() => {}} />);
    fireEvent.focus(screen.getByRole('button', { name: /reação 👍/ }));
    const tooltip = await findTooltip();
    expect(tooltip).toHaveTextContent('Ana e Você reagiram');
  });

  it('clicar no chip alterna aquele emoji e fecha o tooltip', async () => {
    const ue = userEvent.setup();
    const onToggle = vi.fn();
    render(<MessageReactions reactions={{ '😂': ['ana'] }} myUserId="me" allUsers={allUsers} onToggle={onToggle} />);
    const chip = screen.getByRole('button', { name: /reação 😂/ });
    await ue.hover(chip);
    await findTooltip();
    await ue.click(chip);
    expect(onToggle).toHaveBeenCalledWith('😂');
    await waitFor(() => expect(document.querySelector('[data-slot="tooltip-content"]')).not.toBeInTheDocument());
  });
});

describe('ReactionParticipantsDialog', () => {
  const publicUser = (id: string, displayName: string): PublicUser => ({ id, username: id, displayName, avatar: '', avatarColor: 'blurple', banner: '', bio: '', profileLinks: [], role: 'user' });
  const allUsers = new Map([['ana', publicUser('ana', 'Ana')], ['bia', publicUser('bia', 'Bia')]]);
  const message = (over: Partial<ChatMessage> = {}): ChatMessage => ({
    msgId: 1, conversationId: 'c1', id: 'ana', name: 'Ana', avatar: '', text: 'oi', ts: 1, ...over,
  });
  const state = { ...initialRoomState, me: { ...initialRoomState.me, userId: 'me' } };

  it('lista quem reagiu por emoji, com fallback para conta sem dados', () => {
    const msg = message({ reactions: { '👍': ['ana'], '🎉': ['bia', 'sumiu'] } });
    renderWithRoom(<ReactionParticipantsDialog />, {
      state, allUsers, messagesByConversation: new Map([['c1', [msg]]]),
      reactionParticipantsTarget: { conversationId: 'c1', msgId: 1 },
    });
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('tabpanel')).toHaveTextContent('Ana');
    fireEvent.click(within(dialog).getByRole('tab', { name: /🎉/ }));
    expect(within(dialog).getByRole('tabpanel')).toHaveTextContent('Bia');
    expect(within(dialog).getByRole('tabpanel')).toHaveTextContent('Participante indisponível');
  });

  it('abre direto no emoji do alvo, quando informado', () => {
    const msg = message({ reactions: { '👍': ['ana'], '🎉': ['bia'] } });
    renderWithRoom(<ReactionParticipantsDialog />, {
      state, allUsers, messagesByConversation: new Map([['c1', [msg]]]),
      reactionParticipantsTarget: { conversationId: 'c1', msgId: 1, emoji: '🎉' },
    });
    expect(within(screen.getByRole('dialog')).getByRole('tabpanel')).toHaveTextContent('Bia');
  });

  it('sem alvo, o dialogo fica fechado', () => {
    renderWithRoom(<ReactionParticipantsDialog />, {
      state, allUsers, messagesByConversation: new Map(), reactionParticipantsTarget: null,
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('mensagem apagada enquanto aberto: fecha e limpa o alvo', () => {
    const closeReactionParticipants = vi.fn();
    renderWithRoom(<ReactionParticipantsDialog />, {
      state, allUsers, messagesByConversation: new Map([['c1', []]]),
      reactionParticipantsTarget: { conversationId: 'c1', msgId: 1 },
      closeReactionParticipants,
    });
    expect(closeReactionParticipants).toHaveBeenCalled();
  });
});

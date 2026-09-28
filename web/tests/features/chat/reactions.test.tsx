import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import { reactionKey, withPendingReactions } from '@/features/chat/reactionState';
import { useReactionIntents } from '@/features/chat/useReactionIntents';
import { MessageReactions } from '@/features/chat/MessageReactions';
import type { PublicUser } from '@/shared/types/protocol';

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

  it('lista de quem reagiu por emoji, com fallback para conta removida', () => {
    render(<MessageReactions reactions={{ '👍': ['ana'], '🎉': ['bia', 'sumiu'] }} myUserId="me" allUsers={allUsers} onToggle={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ver quem reagiu' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('tabpanel')).toHaveTextContent('Ana');
    fireEvent.click(within(dialog).getByRole('tab', { name: /🎉/ }));
    expect(within(dialog).getByRole('tabpanel')).toHaveTextContent('Bia');
    expect(within(dialog).getByRole('tabpanel')).toHaveTextContent('Usuário removido');
  });

  it('clicar no chip alterna aquele emoji', () => {
    const onToggle = vi.fn();
    render(<MessageReactions reactions={{ '😂': ['ana'] }} myUserId="me" allUsers={allUsers} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole('button', { name: /reação 😂/ }));
    expect(onToggle).toHaveBeenCalledWith('😂');
  });
});

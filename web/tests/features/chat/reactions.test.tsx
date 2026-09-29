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
  it('only the current user\'s participation changes; everyone else\'s stays', () => {
    const pending = new Map([[reactionKey(1, '👍'), true], [reactionKey(1, '🎉'), false], [reactionKey(2, '😂'), true]]);
    expect(withPendingReactions({ '👍': ['ana'], '🎉': ['me', 'bia'] }, 1, pending, 'me')).toEqual({ '👍': ['ana', 'me'], '🎉': ['bia'] });
  });

  it('removing the only reaction makes the chip disappear', () => {
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

  it('rapid clicks converge on the last intent, without a race', async () => {
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

  it('changed their mind mid-send: sends the newer intent afterward', async () => {
    const { result, request, resolvers } = setup();
    act(() => result.current.react(1, '👍', false));
    act(() => result.current.react(1, '👍', false));
    resolvers[0]!.resolve();
    await flush();
    expect(request).toHaveBeenCalledTimes(2);
    expect(resolvers[1]!.msg.present).toBe(false);
  });

  it('failure: discards the intent and reports the reason', async () => {
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

  it('accessible chip: pressed when it is mine, label with action and names', () => {
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

  it('hovering the chip shows who reacted, with a fallback for a participant with no data', async () => {
    const ue = userEvent.setup();
    render(<MessageReactions reactions={{ '🎉': ['bia', 'sumiu'] }} myUserId="me" allUsers={allUsers} onToggle={() => {}} />);
    await ue.hover(screen.getByRole('button', { name: /reação 🎉/ }));
    const tooltip = await findTooltip();
    expect(tooltip).toHaveTextContent('Bia e Participante indisponível reagiram');
  });

  it('focusing the chip shows the same summary, without needing the mouse', async () => {
    render(<MessageReactions reactions={{ '👍': ['ana', 'me'] }} myUserId="me" allUsers={allUsers} onToggle={() => {}} />);
    fireEvent.focus(screen.getByRole('button', { name: /reação 👍/ }));
    const tooltip = await findTooltip();
    expect(tooltip).toHaveTextContent('Ana e Você reagiram');
  });

  it('clicking the chip toggles that emoji and closes the tooltip', async () => {
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

  it('lists who reacted per emoji, with a fallback for an account with no data', () => {
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

  it('opens directly on the target emoji, when given', () => {
    const msg = message({ reactions: { '👍': ['ana'], '🎉': ['bia'] } });
    renderWithRoom(<ReactionParticipantsDialog />, {
      state, allUsers, messagesByConversation: new Map([['c1', [msg]]]),
      reactionParticipantsTarget: { conversationId: 'c1', msgId: 1, emoji: '🎉' },
    });
    expect(within(screen.getByRole('dialog')).getByRole('tabpanel')).toHaveTextContent('Bia');
  });

  it('with no target, the dialog stays closed', () => {
    renderWithRoom(<ReactionParticipantsDialog />, {
      state, allUsers, messagesByConversation: new Map(), reactionParticipantsTarget: null,
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('message deleted while open: closes and clears the target', () => {
    const closeReactionParticipants = vi.fn();
    renderWithRoom(<ReactionParticipantsDialog />, {
      state, allUsers, messagesByConversation: new Map([['c1', []]]),
      reactionParticipantsTarget: { conversationId: 'c1', msgId: 1 },
      closeReactionParticipants,
    });
    expect(closeReactionParticipants).toHaveBeenCalled();
  });
});

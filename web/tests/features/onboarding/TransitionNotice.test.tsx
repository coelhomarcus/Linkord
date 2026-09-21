import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TransitionNotice } from '@/features/onboarding/TransitionNotice';
import { TRANSITION_NOTICE_KEY } from '@/features/onboarding/transitionNoticeStorage';

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('TransitionNotice', () => {
  it('aparece na primeira abertura e explica o novo modelo (grupos, convite, amigos, DMs antigas)', () => {
    render(<TransitionNotice onOpenFriends={vi.fn()} />);
    expect(screen.getByRole('region', { name: 'Novidades' })).toBeInTheDocument();
    expect(screen.getByText(/Qualquer pessoa pode criar grupos/)).toBeInTheDocument();
    expect(screen.getByText(/Ninguém é colocado num grupo/)).toBeInTheDocument();
    expect(screen.getByText(/precisam ser amigos/)).toBeInTheDocument();
  });

  it('dispensar esconde e lembra: uma nova montagem nao mostra de novo', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<TransitionNotice onOpenFriends={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Entendi' }));
    expect(screen.queryByRole('region', { name: 'Novidades' })).not.toBeInTheDocument();
    expect(localStorage.getItem(TRANSITION_NOTICE_KEY)).toBe('1');
    unmount();

    render(<TransitionNotice onOpenFriends={vi.fn()} />);
    expect(screen.queryByRole('region', { name: 'Novidades' })).not.toBeInTheDocument();
  });

  it('"Ver amigos" leva para Amigos e tambem dispensa — sem disparar nada alem da navegacao', async () => {
    const user = userEvent.setup();
    const onOpenFriends = vi.fn();
    render(<TransitionNotice onOpenFriends={onOpenFriends} />);
    await user.click(screen.getByRole('button', { name: 'Ver amigos' }));
    expect(onOpenFriends).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('region', { name: 'Novidades' })).not.toBeInTheDocument();
  });

  it('se o storage falha (modo privado), o aviso ainda funciona e some na sessao', async () => {
    const user = userEvent.setup();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    render(<TransitionNotice onOpenFriends={vi.fn()} />);
    expect(screen.getByRole('region', { name: 'Novidades' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Dispensar aviso' }));
    expect(screen.queryByRole('region', { name: 'Novidades' })).not.toBeInTheDocument();
  });
});

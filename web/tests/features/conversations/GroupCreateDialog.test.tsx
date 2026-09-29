import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRoom } from '@tests/fixtures/roomContextFixture';
import { ana, bea } from '@tests/fixtures/socialFixture';
import { GroupCreateDialog } from '@/features/conversations/GroupCreateDialog';
import * as api from '@/shared/api/api';

vi.mock('@/shared/api/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/api/api')>()),
  fetchFriends: vi.fn(), createGroup: vi.fn(),
}));
const mocked = vi.mocked(api);
const friends = (...users: (typeof ana)[]) => ({ items: users.map((user) => ({ user, at: '2026-01-01T00:00:00.000Z' })), nextCursor: null });

beforeEach(() => {
  vi.clearAllMocks();
  mocked.fetchFriends.mockResolvedValue(friends(ana, bea));
});

function setup() {
  const onOpenChange = vi.fn();
  const onCreated = vi.fn();
  renderWithRoom(<GroupCreateDialog open onOpenChange={onOpenChange} onCreated={onCreated} />);
  return { onOpenChange, onCreated };
}

describe('GroupCreateDialog', () => {
  it('invites only friends and warns that joining depends on acceptance', async () => {
    setup();
    expect(await screen.findByText('Ana')).toBeInTheDocument();
    expect(screen.getByText(/só entram no grupo ao aceitar/)).toBeInTheDocument();
  });

  it('creates with the selected friends via the API and only closes after the result', async () => {
    const user = userEvent.setup();
    let resolve!: (v: Awaited<ReturnType<typeof api.createGroup>>) => void;
    mocked.createGroup.mockReturnValue(new Promise((r) => { resolve = r; }));
    const { onOpenChange, onCreated } = setup();

    await user.type(screen.getByLabelText('Nome'), 'Squad');
    await user.click(await screen.findByRole('button', { name: /Ana/ }));
    await user.click(screen.getByRole('button', { name: 'Criar e convidar (1)' }));
    expect(mocked.createGroup).toHaveBeenCalledWith('Squad', ['u-ana']);
    expect(onOpenChange).not.toHaveBeenCalled();

    resolve({ conversationId: 'g', results: [{ userId: 'u-ana', outcome: 'sent', invitationId: 'i' }] });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onCreated).toHaveBeenCalled();
  });

  it('allows creating without invitees', async () => {
    const user = userEvent.setup();
    mocked.createGroup.mockResolvedValue({ conversationId: 'g', results: [] });
    setup();
    await user.type(screen.getByLabelText('Nome'), 'Sozinho');
    await user.click(screen.getByRole('button', { name: 'Criar grupo' }));
    expect(mocked.createGroup).toHaveBeenCalledWith('Sozinho', []);
  });

  it('the selection survives a new search', async () => {
    const user = userEvent.setup();
    mocked.fetchFriends.mockImplementation(async (_cursor, q) => (q ? friends(bea) : friends(ana, bea)));
    setup();
    await user.click(await screen.findByRole('button', { name: /Ana/ }));
    await user.type(screen.getByPlaceholderText('Buscar amigos'), 'be');
    await waitFor(() => expect(screen.queryByRole('button', { name: /Ana/ })).not.toBeInTheDocument());
    await user.type(screen.getByLabelText('Nome'), 'G');
    expect(screen.getByRole('button', { name: 'Criar e convidar (1)' })).toBeInTheDocument();
  });

  it('failed invites stay visible and the dialog remains open', async () => {
    const user = userEvent.setup();
    mocked.createGroup.mockResolvedValue({ conversationId: 'g', results: [{ userId: 'u-ana', outcome: 'not_friends' }] });
    const { onOpenChange } = setup();
    await user.type(screen.getByLabelText('Nome'), 'Squad');
    await user.click(await screen.findByRole('button', { name: /Ana/ }));
    await user.click(screen.getByRole('button', { name: 'Criar e convidar (1)' }));

    expect(await screen.findByText(/não é mais seu amigo/)).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
    await user.click(screen.getByText('Fechar', { selector: 'button' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('network error keeps the form filled in', async () => {
    const user = userEvent.setup();
    mocked.createGroup.mockRejectedValue(new Error('x'));
    setup();
    await user.type(screen.getByLabelText('Nome'), 'Squad');
    await user.click(screen.getByRole('button', { name: 'Criar grupo' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Não foi possível criar/);
    expect(screen.getByLabelText('Nome')).toHaveValue('Squad');
  });
});

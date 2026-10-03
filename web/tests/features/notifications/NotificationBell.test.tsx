import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router';
import { renderSocial, ana } from '@tests/fixtures/socialFixture';
import { NotificationBell } from '@/features/notifications/NotificationBell';
import * as api from '@/shared/api/api';
import type { NotificationEntry } from '@/shared/api/api';

vi.mock('@/shared/api/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/api/api')>()),
  fetchNotifications: vi.fn(), fetchUnreadNotificationCount: vi.fn(), markNotificationsRead: vi.fn(), fetchRequestSummary: vi.fn(), deleteNotification: vi.fn(), clearNotifications: vi.fn(),
}));
const mocked = vi.mocked(api);

const entry = (over: Partial<NotificationEntry> = {}): NotificationEntry => ({
  id: 'n1', kind: 'friend_request', at: new Date().toISOString(), read: false, friendshipId: 'f1', invitationId: null, actor: ana, group: null, ...over,
});

function Where() { const l = useLocation(); return <p data-testid="where">{l.pathname}{l.search}</p>; }
const renderBell = () => renderSocial(<><NotificationBell /><Routes><Route path="*" element={<Where />} /></Routes></>);

beforeEach(() => {
  vi.clearAllMocks();
  mocked.fetchRequestSummary.mockResolvedValue({ incoming: 0, invitations: 0 });
  mocked.markNotificationsRead.mockResolvedValue({ marked: 1 });
  mocked.deleteNotification.mockResolvedValue({ deleted: 1 });
  mocked.clearNotifications.mockResolvedValue({ deleted: 2 });
});

describe('NotificationBell', () => {
  it('shows the unread counter and 9+ above nine', async () => {
    mocked.fetchUnreadNotificationCount.mockResolvedValue({ unread: 12 });
    mocked.fetchNotifications.mockResolvedValue({ items: [], nextCursor: null });
    renderBell();
    expect(await screen.findByText('9+')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Notificações, 12 não lidas' })).toBeInTheDocument();
  });

  it('empty list', async () => {
    const user = userEvent.setup();
    mocked.fetchUnreadNotificationCount.mockResolvedValue({ unread: 0 });
    mocked.fetchNotifications.mockResolvedValue({ items: [], nextCursor: null });
    renderBell();
    await user.click(screen.getByRole('button', { name: 'Notificações' }));
    expect(await screen.findByText('Nenhuma notificação por enquanto.')).toBeInTheDocument();
  });

  it('clicking an item marks it as read and navigates', async () => {
    const user = userEvent.setup();
    mocked.fetchUnreadNotificationCount.mockResolvedValue({ unread: 1 });
    mocked.fetchNotifications.mockResolvedValue({ items: [entry({ kind: 'group_invitation', invitationId: 'i1', friendshipId: null, group: { id: 'g', title: 'Squad', avatar: '' } })], nextCursor: null });
    renderBell();
    await user.click(await screen.findByRole('button', { name: 'Notificações, 1 não lida' }));
    await user.click(await screen.findByText('Ana convidou você para o grupo Squad'));
    expect(mocked.markNotificationsRead).toHaveBeenCalledWith({ ids: ['n1'] });
    expect(screen.getByTestId('where')).toHaveTextContent('/app/friends?tab=invitations');
  });

  it('an already-read item does not call the API on click', async () => {
    const user = userEvent.setup();
    mocked.fetchUnreadNotificationCount.mockResolvedValue({ unread: 0 });
    mocked.fetchNotifications.mockResolvedValue({ items: [entry({ read: true, kind: 'friend_accepted' })], nextCursor: null });
    renderBell();
    await user.click(screen.getByRole('button', { name: 'Notificações' }));
    await user.click(await screen.findByText('Ana aceitou sua solicitação de amizade'));
    expect(mocked.markNotificationsRead).not.toHaveBeenCalled();
    expect(screen.getByTestId('where')).toHaveTextContent('/app/friends');
  });

  it('marking all as read', async () => {
    const user = userEvent.setup();
    mocked.fetchUnreadNotificationCount.mockResolvedValue({ unread: 2 });
    mocked.fetchNotifications.mockResolvedValue({ items: [entry()], nextCursor: null });
    renderBell();
    await user.click(await screen.findByRole('button', { name: 'Notificações, 2 não lidas' }));
    await user.click(await screen.findByRole('button', { name: 'Marcar todas como lidas' }));
    expect(mocked.markNotificationsRead).toHaveBeenCalledWith({ all: true });
  });

  it('a failure marking as read shows the error and reloads the real counter', async () => {
    const user = userEvent.setup();
    mocked.fetchUnreadNotificationCount.mockResolvedValue({ unread: 2 });
    mocked.fetchNotifications.mockResolvedValue({ items: [entry()], nextCursor: null });
    mocked.markNotificationsRead.mockRejectedValue(new Error('rede'));
    renderBell();
    await user.click(await screen.findByRole('button', { name: 'Notificações, 2 não lidas' }));
    await user.click(await screen.findByRole('button', { name: 'Marcar todas como lidas' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    await waitFor(() => expect(mocked.fetchUnreadNotificationCount.mock.calls.length).toBeGreaterThan(1));
  });

  it('a loading error offers a retry', async () => {
    const user = userEvent.setup();
    mocked.fetchUnreadNotificationCount.mockResolvedValue({ unread: 0 });
    mocked.fetchNotifications.mockRejectedValueOnce(new Error('x')).mockResolvedValue({ items: [entry()], nextCursor: null });
    renderBell();
    await user.click(screen.getByRole('button', { name: 'Notificações' }));
    await user.click(await screen.findByRole('button', { name: 'Tentar de novo' }));
    expect(await screen.findByText('Ana enviou uma solicitação de amizade')).toBeInTheDocument();
  });

  it('dismissing an item calls the API without navigating and without marking as read', async () => {
    const user = userEvent.setup();
    mocked.fetchUnreadNotificationCount.mockResolvedValue({ unread: 1 });
    mocked.fetchNotifications.mockResolvedValue({ items: [entry()], nextCursor: null });
    renderBell();
    await user.click(await screen.findByRole('button', { name: 'Notificações, 1 não lida' }));
    await user.click(await screen.findByRole('button', { name: 'Descartar notificação' }));
    expect(mocked.deleteNotification).toHaveBeenCalledWith('n1');
    expect(mocked.markNotificationsRead).not.toHaveBeenCalled();
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/$/);
  });

  it('clearing everything wipes out the whole list', async () => {
    const user = userEvent.setup();
    mocked.fetchUnreadNotificationCount.mockResolvedValue({ unread: 0 });
    mocked.fetchNotifications.mockResolvedValue({ items: [entry({ read: true })], nextCursor: null });
    renderBell();
    await user.click(screen.getByRole('button', { name: 'Notificações' }));
    await user.click(await screen.findByRole('button', { name: 'Limpar tudo' }));
    expect(mocked.clearNotifications).toHaveBeenCalled();
  });

  it('a failure dismissing shows the error and reloads the real state', async () => {
    const user = userEvent.setup();
    mocked.fetchUnreadNotificationCount.mockResolvedValue({ unread: 0 });
    mocked.fetchNotifications.mockResolvedValue({ items: [entry({ read: true })], nextCursor: null });
    mocked.deleteNotification.mockRejectedValue(new Error('rede'));
    renderBell();
    await user.click(screen.getByRole('button', { name: 'Notificações' }));
    await user.click(await screen.findByRole('button', { name: 'Descartar notificação' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    await waitFor(() => expect(mocked.fetchUnreadNotificationCount.mock.calls.length).toBeGreaterThan(1));
  });
});

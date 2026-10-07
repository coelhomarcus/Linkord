import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { adminRoom, renderAdmin } from './adminFixture';
import { renderWithRoom } from '@tests/fixtures/roomContextFixture';
import AdminArea from '@/features/admin/AdminArea';
import { invalidateAdminLists, readListWindow, saveListWindow } from '@/features/admin/adminListCache';
import * as adminApi from '@/features/admin/adminApi';

vi.mock('@/shared/PageHeader', () => ({ PageHeader: ({ title }: { title: string }) => <h1>{title}</h1> }));
vi.mock('@/features/admin/adminApi');
const mocked = vi.mocked(adminApi);

const user = (id: string): adminApi.AdminUserRow => ({
  id, username: id, displayName: id.toUpperCase(), avatar: '', avatarColor: 'blurple', role: 'user', status: 'active', createdAt: '2026-01-01T00:00:00.000Z',
});
const detail = (id: string): adminApi.AdminUserDetail => ({
  user: { ...user(id), email: `${id}@example.com`, statusReason: '', statusChangedAt: null },
  groups: [], storage: { bytes: 0, files: 0 }, history: [],
});

const scrollTo = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  invalidateAdminLists();
  Element.prototype.scrollTo = scrollTo as unknown as typeof Element.prototype.scrollTo;
  mocked.fetchAdminUser.mockImplementation((id) => Promise.resolve(detail(id)));
  mocked.fetchAdminUsers.mockImplementation((_filters, cursor) => Promise.resolve(
    cursor ? { items: [user('cai')], nextCursor: null } : { items: [user('ana'), user('bia')], nextCursor: 'c2' },
  ));
});
afterEach(() => { delete (Element.prototype as { scrollTo?: unknown }).scrollTo; });

const renderArea = (path = '/admin/users') => renderAdmin(<AdminArea />, { path, pattern: '/admin/*' });

describe('coming back to a list', () => {
  it('the back link restores the rows already loaded, at once, and re-reads them in the background', async () => {
    const u = userEvent.setup();
    renderArea();
    await u.click(await screen.findByRole('button', { name: 'Carregar mais' }));
    expect(await screen.findByText('CAI')).toBeInTheDocument();

    await u.click(screen.getByRole('link', { name: /BIA.*@bia/ }));
    expect(await screen.findByText('bia@example.com')).toBeInTheDocument();

    // the re-read is held back: what shows now can only come from the restored window
    mocked.fetchAdminUsers.mockClear();
    mocked.fetchAdminUsers.mockImplementation(() => new Promise(() => {}));
    await u.click(screen.getByRole('link', { name: '← Usuários' }));
    expect(screen.getByText('CAI')).toBeInTheDocument();
    expect(screen.getByText('ANA')).toBeInTheDocument();
    expect(screen.queryByText('Carregando…')).not.toBeInTheDocument();
    await waitFor(() => expect(mocked.fetchAdminUsers).toHaveBeenCalledWith(expect.anything(), null));
  });

  it('a fresh visit (no back) starts from the first page', async () => {
    const u = userEvent.setup();
    renderWithRoom(
      <MemoryRouter initialEntries={['/admin/users']}>
        <Routes>
          <Route path="/admin/*" element={<AdminArea />} />
        </Routes>
      </MemoryRouter>,
      adminRoom(),
    );
    await u.click(await screen.findByRole('button', { name: 'Carregar mais' }));
    await screen.findByText('CAI');
    await u.click(screen.getByRole('link', { name: /BIA.*@bia/ }));
    await screen.findByText('bia@example.com');

    await u.click(screen.getByRole('link', { name: 'Usuários' }));
    expect(await screen.findByText('ANA')).toBeInTheDocument();
    expect(screen.queryByText('CAI')).not.toBeInTheDocument();
  });

  it('puts the scroll position back instead of scrolling to the top', async () => {
    const u = userEvent.setup();
    renderArea();
    await screen.findByText('ANA');
    const main = screen.getByRole('main');
    Object.defineProperty(main, 'scrollTop', { value: 420, configurable: true });
    fireEvent.scroll(main);

    await u.click(screen.getByRole('link', { name: /BIA.*@bia/ }));
    await screen.findByText('bia@example.com');
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 0 });

    scrollTo.mockClear();
    await u.click(screen.getByRole('link', { name: '← Usuários' }));
    await screen.findByText('ANA');
    expect(scrollTo).toHaveBeenCalledWith({ top: 420 });
    expect(scrollTo).not.toHaveBeenCalledWith({ top: 0 });
  });

  it('an invalidated memory (an admin action in between) restores nothing', async () => {
    const u = userEvent.setup();
    renderArea();
    await u.click(await screen.findByRole('button', { name: 'Carregar mais' }));
    await screen.findByText('CAI');
    await u.click(screen.getByRole('link', { name: /BIA.*@bia/ }));
    await screen.findByText('bia@example.com');

    invalidateAdminLists();
    await u.click(screen.getByRole('link', { name: '← Usuários' }));
    expect(await screen.findByText('ANA')).toBeInTheDocument();
    expect(screen.queryByText('CAI')).not.toBeInTheDocument();
  });
});

describe('list memory', () => {
  const snapshot = { items: [{ id: 'a' }], nextCursor: null, pages: 1 };

  it('keeps only the most recent windows', () => {
    for (let i = 0; i < 10; i++) saveListWindow(`k${i}`, snapshot, 0);
    expect(readListWindow('k0')).toBeNull();
    expect(readListWindow('k1')).toBeNull();
    expect(readListWindow('k9')).not.toBeNull();
  });

  it('leaving the admin area forgets everything', async () => {
    const { unmount } = renderArea();
    await screen.findByText('ANA');
    saveListWindow('x', snapshot, 10);
    unmount();
    expect(readListWindow('x')).toBeNull();
  });
});

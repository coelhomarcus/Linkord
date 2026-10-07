import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderAdmin } from './adminFixture';
import AdminArea from '@/features/admin/AdminArea';
import * as adminApi from '@/features/admin/adminApi';

// No mock of the layout hook on purpose: the real measurement runs, the way it
// does in a browser (a hook mocked to return "compact" from the first render
// hid the redirect that happens BEFORE the first measurement).
vi.mock('@/shared/PageHeader', () => ({ PageHeader: ({ title }: { title: string }) => <h1>{title}</h1> }));
vi.mock('@/features/admin/adminApi');
const mocked = vi.mocked(adminApi);

const realRect = Element.prototype.getBoundingClientRect;
const box = (width: number) => ({ width, height: 600, top: 0, left: 0, right: width, bottom: 600, x: 0, y: 0, toJSON: () => ({}) });
/** `area`: the box that decides sidebar vs index; `content`: the column that decides table vs stacked rows. */
const withWidths = (area: number, content = area) => {
  Element.prototype.getBoundingClientRect = function rect() {
    if (this.classList.contains('@container')) return box(area);
    if (this.className.includes('@[960px]:px-8')) return box(content);
    return realRect.call(this);
  };
};
const withAreaWidth = (width: number) => withWidths(width);

beforeEach(() => {
  vi.clearAllMocks();
  mocked.fetchAdminUsers.mockResolvedValue({ items: [], nextCursor: null });
});
afterEach(() => { Element.prototype.getBoundingClientRect = realRect; });

describe('the bare /admin entry, with the real measurement', () => {
  it('a narrow area opens the section index — it is not redirected to Users before being measured', async () => {
    withAreaWidth(700);
    renderAdmin(<AdminArea />, { path: '/admin', pattern: '/admin/*' });
    expect(await screen.findByRole('link', { name: 'Auditoria' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Administração' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Voltar à administração' })).not.toBeInTheDocument();
    expect(mocked.fetchAdminUsers).not.toHaveBeenCalled();
  });

  it('a wide area still lands on Users', async () => {
    withAreaWidth(1200);
    renderAdmin(<AdminArea />, { path: '/admin', pattern: '/admin/*' });
    expect(await screen.findByText('Nenhuma conta encontrada.')).toBeInTheDocument();
  });
});

describe('table or stacked rows follows the CONTENT column, not the area', () => {
  it('a wide area whose content column is narrow (conversation list open on a laptop) stacks the rows — no cut-off columns', async () => {
    mocked.fetchAdminUsers.mockResolvedValue({ items: [{ id: 'u1', username: 'ana', displayName: 'Ana', avatar: '', avatarColor: 'blurple', role: 'user', status: 'active', createdAt: '2026-01-01T00:00:00.000Z' }], nextCursor: null });
    withWidths(972, 732);
    renderAdmin(<AdminArea />, { path: '/admin/users', pattern: '/admin/*' });
    expect(await screen.findByText('Ana')).toBeInTheDocument();
    // the sidebar stays (the area is wide) while the list is stacked
    expect(screen.getByRole('link', { name: 'Grupos' })).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('a wide content column gets the table', async () => {
    mocked.fetchAdminUsers.mockResolvedValue({ items: [{ id: 'u1', username: 'ana', displayName: 'Ana', avatar: '', avatarColor: 'blurple', role: 'user', status: 'active', createdAt: '2026-01-01T00:00:00.000Z' }], nextCursor: null });
    withWidths(1300, 1060);
    renderAdmin(<AdminArea />, { path: '/admin/users', pattern: '/admin/*' });
    expect(await screen.findByRole('table', { name: 'Contas' })).toBeInTheDocument();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { reportAdminAccessLost } from '@/features/admin/adminAccess';
import { renderAdmin, adminRoom } from './adminFixture';
import AdminArea from '@/features/admin/AdminArea';
import * as adminApi from '@/features/admin/adminApi';
import { useAdminLayout } from '@/features/admin/useAdminLayout';

vi.mock('@/shared/PageHeader', () => ({
  PageHeader: ({ title, subtitle, leading }: { title: string; subtitle?: string; leading?: React.ReactNode }) => (
    <header>{leading}<h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</header>
  ),
}));
vi.mock('@/features/admin/adminApi');
vi.mock('@/features/admin/useAdminLayout', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/admin/useAdminLayout')>()),
  useAdminLayout: vi.fn(() => 'wide'),
}));
const mocked = vi.mocked(adminApi);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useAdminLayout).mockReturnValue('wide');
  mocked.fetchAdminUsers.mockResolvedValue({ items: [], nextCursor: null });
  mocked.fetchAdminUser.mockReturnValue(new Promise(() => {}));
  mocked.fetchAdminReport.mockReturnValue(new Promise(() => {}));
});

describe('AdminArea', () => {
  it('a non-admin is redirected back to conversations (the UI only hides; the server decides)', () => {
    renderAdmin(<AdminArea />, { path: '/admin/users', pattern: '/admin/*', room: adminRoom('user') });
    expect(screen.getByText('outra rota')).toBeInTheDocument();
    expect(mocked.fetchAdminUsers).not.toHaveBeenCalled();
  });

  it('admin sees navigation for all five sections and the current one is marked', async () => {
    renderAdmin(<AdminArea />, { path: '/admin/users', pattern: '/admin/*' });
    for (const label of ['Usuários', 'Grupos', 'Denúncias', 'Auditoria', 'Sistema']) {
      expect(screen.getByRole('link', { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole('link', { name: 'Usuários' })).toHaveAttribute('aria-current', 'page');
    expect(await screen.findByText('Nenhuma conta encontrada.')).toBeInTheDocument();
  });

  it('a detail page keeps its section marked', async () => {
    renderAdmin(<AdminArea />, { path: '/admin/reports/r1', pattern: '/admin/*' });
    expect(screen.getByRole('link', { name: 'Denúncias' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Usuários' })).not.toHaveAttribute('aria-current');
  });

  it('unknown route inside /admin falls back to Users', async () => {
    renderAdmin(<AdminArea />, { path: '/admin/nada', pattern: '/admin/*' });
    expect(await screen.findByText('Nenhuma conta encontrada.')).toBeInTheDocument();
  });

  it('the bare /admin entry opens Users in wide mode', async () => {
    renderAdmin(<AdminArea />, { path: '/admin', pattern: '/admin/*' });
    expect(await screen.findByText('Nenhuma conta encontrada.')).toBeInTheDocument();
  });

  describe('compact', () => {
    beforeEach(() => vi.mocked(useAdminLayout).mockReturnValue('compact'));

    it('the bare /admin entry is the section index, not a redirect', () => {
      renderAdmin(<AdminArea />, { path: '/admin', pattern: '/admin/*' });
      expect(screen.getByRole('heading', { name: 'Administração' })).toBeInTheDocument();
      for (const label of ['Usuários', 'Grupos', 'Denúncias', 'Auditoria', 'Sistema']) {
        expect(screen.getByRole('link', { name: label })).toBeInTheDocument();
      }
      expect(mocked.fetchAdminUsers).not.toHaveBeenCalled();
    });

    it('a section shows its own title with a way back to the index, and no sidebar', async () => {
      renderAdmin(<AdminArea />, { path: '/admin/users', pattern: '/admin/*' });
      expect(screen.getByRole('heading', { name: 'Usuários' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Voltar à administração' })).toHaveAttribute('href', '/admin');
      expect(screen.queryByRole('link', { name: 'Grupos' })).not.toBeInTheDocument();
      expect(await screen.findByText('Nenhuma conta encontrada.')).toBeInTheDocument();
    });

    it('a detail URL is never redirected because of the window size', async () => {
      renderAdmin(<AdminArea />, { path: '/admin/users/u1', pattern: '/admin/*' });
      expect(screen.getByRole('link', { name: 'Voltar à administração' })).toBeInTheDocument();
      expect(mocked.fetchAdminUsers).not.toHaveBeenCalled();
    });
  });

  it('losing admin access replaces the pages with an explanation, then leaves for the conversations', async () => {
    const u = userEvent.setup();
    const dispatch = vi.fn();
    renderAdmin(<AdminArea />, { path: '/admin/users', pattern: '/admin/*', room: { ...adminRoom(), dispatch } });
    expect(await screen.findByText('Nenhuma conta encontrada.')).toBeInTheDocument();

    act(() => reportAdminAccessLost());
    expect(screen.getByRole('alert')).toHaveTextContent('Você não tem mais acesso à administração');
    expect(screen.queryByText('Nenhuma conta encontrada.')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Grupos' })).not.toBeInTheDocument();

    await u.click(screen.getByRole('button', { name: 'Voltar às conversas' }));
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_ROLE', role: 'user' });
    expect(screen.getByText('outra rota')).toBeInTheDocument();
  });
});

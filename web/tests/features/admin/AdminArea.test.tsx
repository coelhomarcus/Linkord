import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderAdmin, adminRoom } from './adminFixture';
import AdminArea from '@/features/admin/AdminArea';
import * as adminApi from '@/features/admin/adminApi';

vi.mock('@/shared/PageHeader', () => ({ PageHeader: ({ title }: { title: string }) => <h1>{title}</h1> }));
vi.mock('@/features/admin/adminApi');
const mocked = vi.mocked(adminApi);

beforeEach(() => {
  vi.clearAllMocks();
  mocked.fetchAdminUsers.mockResolvedValue({ items: [], nextCursor: null });
});

describe('AdminArea', () => {
  it('a non-admin is redirected back to conversations (the UI only hides; the server decides)', () => {
    renderAdmin(<AdminArea />, { path: '/admin/users', pattern: '/admin/*', room: adminRoom('user') });
    expect(screen.getByText('outra rota')).toBeInTheDocument();
    expect(mocked.fetchAdminUsers).not.toHaveBeenCalled();
  });

  it('admin sees navigation for all four sections', async () => {
    renderAdmin(<AdminArea />, { path: '/admin/users', pattern: '/admin/*' });
    for (const label of ['Usuários', 'Grupos', 'Denúncias', 'Auditoria']) {
      expect(screen.getByRole('link', { name: label })).toBeInTheDocument();
    }
    expect(await screen.findByText('Nenhuma conta encontrada.')).toBeInTheDocument();
  });

  it('unknown route inside /admin falls back to Users', async () => {
    renderAdmin(<AdminArea />, { path: '/admin/nada', pattern: '/admin/*' });
    expect(await screen.findByText('Nenhuma conta encontrada.')).toBeInTheDocument();
  });
});

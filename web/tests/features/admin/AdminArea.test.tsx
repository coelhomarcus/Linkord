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
  it('quem nao e admin volta para as conversas (a UI so esconde; o servidor decide)', () => {
    renderAdmin(<AdminArea />, { path: '/admin/users', pattern: '/admin/*', room: adminRoom('user') });
    expect(screen.getByText('outra rota')).toBeInTheDocument();
    expect(mocked.fetchAdminUsers).not.toHaveBeenCalled();
  });

  it('admin ve a navegacao das quatro secoes', async () => {
    renderAdmin(<AdminArea />, { path: '/admin/users', pattern: '/admin/*' });
    for (const label of ['Usuários', 'Grupos', 'Denúncias', 'Auditoria']) {
      expect(screen.getByRole('link', { name: label })).toBeInTheDocument();
    }
    expect(await screen.findByText('Nenhuma conta encontrada.')).toBeInTheDocument();
  });

  it('rota desconhecida dentro de /admin cai em Usuarios', async () => {
    renderAdmin(<AdminArea />, { path: '/admin/nada', pattern: '/admin/*' });
    expect(await screen.findByText('Nenhuma conta encontrada.')).toBeInTheDocument();
  });
});

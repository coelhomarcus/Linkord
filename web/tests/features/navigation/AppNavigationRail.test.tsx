import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { initialRoomState } from '@/state/roomReducer';
import { renderSocial } from '@tests/fixtures/socialFixture';
import { AnimatedSidebarProvider } from '@/shared/ui/motion/animated-sidebar';
import { TooltipProvider } from '@/shared/ui/primitives/tooltip';
import { AppNavigationRail } from '@/features/navigation/AppNavigationRail';
import * as api from '@/shared/api/api';

vi.mock('@/shared/api/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/shared/api/api')>()),
  fetchRequestSummary: vi.fn(), fetchUnreadNotificationCount: vi.fn(), fetchNotifications: vi.fn(),
}));
const mocked = vi.mocked(api);
const me = { ...initialRoomState, me: { ...initialRoomState.me, id: 'c', userId: 'me', name: 'fulana', displayName: 'Fulana' } };

function renderRail(path = '/app/conversations', open = true) {
  const onOpenProfile = vi.fn();
  const onOpenChange = vi.fn();
  renderSocial(
    <TooltipProvider>
      <AnimatedSidebarProvider open={open} onOpenChange={onOpenChange}>
        <AppNavigationRail onOpenProfile={onOpenProfile} />
      </AnimatedSidebarProvider>
    </TooltipProvider>,
    { room: { state: me }, path },
  );
  return { onOpenProfile, onOpenChange };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocked.fetchRequestSummary.mockResolvedValue({ incoming: 0, invitations: 0 });
  mocked.fetchUnreadNotificationCount.mockResolvedValue({ unread: 0 });
  mocked.fetchNotifications.mockResolvedValue({ items: [], nextCursor: null });
});

describe('AppNavigationRail', () => {
  it('tem os destinos globais e nenhum atalho de Solicitacoes', () => {
    renderRail();
    const nav = screen.getByRole('navigation', { name: 'Navegação principal' });
    expect(nav).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Conversas' })).toHaveAttribute('href', '/app/conversations');
    expect(screen.getByRole('link', { name: 'Amigos' })).toHaveAttribute('href', '/app/friends');
    expect(screen.getByRole('link', { name: 'Ajustes' })).toHaveAttribute('href', '/app/settings');
    expect(screen.getByRole('button', { name: 'Meu perfil' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Notificações/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Solicitações/ })).not.toBeInTheDocument();
  });

  it.each([
    ['/app/conversations/abc', 'Conversas'],
    ['/app/friends?tab=pending', 'Amigos'],
    ['/app/settings/av', 'Ajustes'],
    ['/admin/users', 'Ajustes'],
  ])('em %s so "%s" fica marcado como pagina atual', (path, current) => {
    renderRail(path);
    const marked = screen.getAllByRole('link').filter((link) => link.getAttribute('aria-current') === 'page').map((link) => link.getAttribute('aria-label'));
    expect(marked).toEqual([current]);
  });

  it('o badge de Amigos soma pedidos e convites recebidos e o nome acessivel diz o que conta', async () => {
    mocked.fetchRequestSummary.mockResolvedValue({ incoming: 2, invitations: 1 });
    renderRail();
    expect(await screen.findByRole('link', { name: 'Amigos, 3 aguardando resposta' })).toBeInTheDocument();
  });

  it('Meu perfil abre o perfil da propria conta', async () => {
    const { onOpenProfile } = renderRail();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Meu perfil' }));
    expect(onOpenProfile).toHaveBeenCalledWith('me');
  });

  it('com a lista aberta o rail nao repete o botao de ocultar (fica no cabecalho da lista)', () => {
    renderRail('/app/conversations', true);
    expect(screen.queryByRole('button', { name: /lista de conversas/ })).not.toBeInTheDocument();
  });

  it('com a lista recolhida o rail oferece o caminho de volta', async () => {
    const { onOpenChange } = renderRail('/app/conversations', false);
    const toggle = screen.getByRole('button', { name: 'Mostrar lista de conversas' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await userEvent.setup().click(toggle);
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

/** Pretends the window is `width` wide for the `(max-width: Npx)` queries the sidebar reads. */
function setViewport(width: number) {
  window.matchMedia = ((query: string) => {
    const max = /max-width:\s*(\d+)px/.exec(query);
    return {
      matches: max ? width <= Number(max[1]) : false, media: query, onchange: null,
      addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
    } as unknown as MediaQueryList;
  }) as typeof window.matchMedia;
}
const originalMatchMedia = window.matchMedia;

function renderRail(path = '/app/conversations', open = true, openMobile = false, roomOverrides: Partial<import('@/state/RoomContext').RoomContextValue> = {}) {
  const onOpenProfile = vi.fn();
  const onOpenChange = vi.fn();
  const onOpenMobileChange = vi.fn();
  const onReturnToCall = vi.fn();
  renderSocial(
    <TooltipProvider>
      <AnimatedSidebarProvider open={open} onOpenChange={onOpenChange} openMobile={openMobile} onOpenMobileChange={onOpenMobileChange}>
        <AppNavigationRail onOpenProfile={onOpenProfile} onReturnToCall={onReturnToCall} />
      </AnimatedSidebarProvider>
    </TooltipProvider>,
    { room: { state: me, ...roomOverrides }, path },
  );
  return { onOpenProfile, onOpenChange, onOpenMobileChange, onReturnToCall };
}

afterEach(() => { window.matchMedia = originalMatchMedia; });

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
  ])('em %s so "%s" fica marcado como pagina atual', (path, current) => {
    renderRail(path);
    const marked = screen.getAllByRole('link').filter((link) => link.getAttribute('aria-current') === 'page').map((link) => link.getAttribute('aria-label'));
    expect(marked).toEqual([current]);
  });

  it('/admin/users nao marca Ajustes como pagina atual (categorias separadas)', () => {
    renderRail('/admin/users');
    expect(screen.getByRole('link', { name: 'Ajustes' })).not.toHaveAttribute('aria-current');
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

  it('sem chamada ativa, sem icone de voltar pra chamada', () => {
    renderRail();
    expect(screen.queryByRole('button', { name: /Voltar para/ })).not.toBeInTheDocument();
  });

  it('com chamada ativa, o icone verde aparece com o titulo da conversa e chama onReturnToCall', async () => {
    const group = {
      id: 'conv-1', type: 'group' as const, title: 'os xerecas', avatar: '', createdBy: 'me', memberIds: ['me'],
      lastMessageAt: null, createdAt: 0, updatedAt: 0, pinnedAt: null, myRole: 'owner' as const, ownerId: 'me', memberCount: 1,
    };
    const { onReturnToCall } = renderRail('/app/conversations', true, false, { activeCallConversationId: 'conv-1', conversations: [group] });
    const button = screen.getByRole('button', { name: 'Voltar para os xerecas' });
    expect(button).toBeInTheDocument();
    await userEvent.setup().click(button);
    expect(onReturnToCall).toHaveBeenCalledTimes(1);
  });

  it('sem ser admin, sem atalho de area administrativa', () => {
    renderRail();
    expect(screen.queryByRole('link', { name: 'Área administrativa' })).not.toBeInTheDocument();
  });
});

describe('AppNavigationRail — admin', () => {
  const admin = { ...me, me: { ...me.me, role: 'admin' as const } };

  it('admin ve o atalho de area administrativa, indo direto pra /admin/users', () => {
    renderRail('/app/conversations', true, false, { state: admin });
    expect(screen.getByRole('link', { name: 'Área administrativa' })).toHaveAttribute('href', '/admin/users');
  });

  it('em /admin/users, so a Area administrativa fica marcada (nao Ajustes)', () => {
    renderRail('/admin/users', true, false, { state: admin });
    const marked = screen.getAllByRole('link').filter((link) => link.getAttribute('aria-current') === 'page').map((link) => link.getAttribute('aria-label'));
    expect(marked).toEqual(['Área administrativa']);
  });
});

describe('AppNavigationRail — largura da janela', () => {
  it('desktop (>= 1024): a lista e uma coluna; o rail so oferece "mostrar" se ela estiver recolhida', () => {
    setViewport(1440);
    renderRail('/app/conversations', true);
    expect(screen.queryByRole('button', { name: 'Mostrar lista de conversas' })).not.toBeInTheDocument();
  });

  it('tablet (768-1023): a lista e um drawer aberto pelo rail, que nao muda a preferencia de recolher', async () => {
    setViewport(900);
    const { onOpenChange, onOpenMobileChange } = renderRail('/app/conversations', true, false);
    const toggle = screen.getByRole('button', { name: 'Mostrar lista de conversas' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await userEvent.setup().click(toggle);
    expect(onOpenMobileChange).toHaveBeenCalledWith(true);
    expect(onOpenChange).not.toHaveBeenCalled(); // the saved collapsed/expanded preference is untouched
  });

  it('tablet: com o drawer aberto o botao diz expandido', () => {
    setViewport(900);
    renderRail('/app/conversations', true, true);
    expect(screen.getByRole('button', { name: 'Mostrar lista de conversas' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('navegar pelo rail com o drawer aberto fecha o drawer', async () => {
    setViewport(900);
    const { onOpenMobileChange } = renderRail('/app/conversations', true, true);
    await userEvent.setup().click(screen.getByRole('link', { name: 'Amigos' }));
    expect(onOpenMobileChange).toHaveBeenCalledWith(false);
  });

  it('desktop: navegar pelo rail nao mexe em drawer nenhum', async () => {
    setViewport(1440);
    const { onOpenMobileChange } = renderRail('/app/conversations', true, false);
    await userEvent.setup().click(screen.getByRole('link', { name: 'Amigos' }));
    expect(onOpenMobileChange).not.toHaveBeenCalledWith(false);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { RouterProvider, createMemoryRouter, useLocation } from 'react-router';
import userEvent from '@testing-library/user-event';
import { initialRoomState } from '@/state/roomReducer';
import { renderWithRoom } from '@tests/fixtures/roomContextFixture';
import type { RoomContextValue } from '@/state/RoomContext';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { ProfileSaveRefused } from '@/features/profile/useProfileUpdate';

vi.mock('@/state/AuthContext', () => ({
  useAuth: () => ({ logout: vi.fn() }),
}));

// the page header needs the animated-sidebar provider and the privacy tab
// needs the friends provider — neither is what these tests are about
vi.mock('@/shared/PageHeader', () => ({
  PageHeader: ({ title, leading }: { title: string; leading?: React.ReactNode }) => <header>{leading}<h1>{title}</h1></header>,
}));
vi.mock('@/features/settings/PrivacyTab', () => ({ PrivacyTab: () => <p>lista de bloqueados</p> }));

// A real (memory) data router, not just MemoryRouter/<Routes> — ProfileSettings
// calls useBlocker for the unsaved-changes guard, which only works with one.
function renderSettings(overrides: Partial<RoomContextValue> = {}, path = '/app/settings/profile') {
  const router = createMemoryRouter(
    [{ path: '/app/settings/:tab?', element: <SettingsPage onOpenProfile={vi.fn()} /> }],
    { initialEntries: [path] },
  );
  return { ...renderWithRoom(<RouterProvider router={router} />, overrides), router };
}

vi.mock('@/features/settings/ImageCropDialog', () => ({
  ImageCropDialog: ({ open, onConfirm, onCancel }: { open: boolean; onConfirm: (crop: { x: number; y: number; width: number; height: number }) => void; onCancel: () => void }) =>
    open ? (
      <div>
        <button type="button" onClick={() => onConfirm({ x: 0, y: 0, width: 10, height: 10 })}>Confirmar recorte</button>
        <button type="button" onClick={onCancel}>Cancelar recorte</button>
      </div>
    ) : null,
}));

describe('SettingsPage — perfil', () => {
  it('salva a cor escolhida para o fundo do avatar', async () => {
    const user = userEvent.setup();
    const updateProfile = vi.fn();
    const state = {
      ...initialRoomState,
      me: {
        ...initialRoomState.me,
        id: 'conn-1',
        userId: 'user-1',
        name: 'Fulana',
        displayName: 'Fulana',
        avatar: '',
        avatarColor: 'green',
      },
    };

    renderSettings({ state, updateProfile });

    await user.click(screen.getByRole('button', { name: 'Usar Fuchsia' }));
    await user.click(screen.getByRole('button', { name: 'Salvar perfil' }));
    expect(screen.getByRole('button', { name: 'Perfil salvo' })).toBeInTheDocument();

    expect(updateProfile).toHaveBeenCalledWith({
      avatar: '',
      avatarPoster: '',
      avatarColor: 'fuchsia',
      displayName: 'Fulana',
      banner: '',
      bannerPoster: '',
      bio: '',
      profileLinks: [],
    });
  });

  it('salva um nome de exibicao novo, diferente do username', async () => {
    const user = userEvent.setup();
    const updateProfile = vi.fn();
    const state = {
      ...initialRoomState,
      me: {
        ...initialRoomState.me,
        id: 'conn-1',
        userId: 'user-1',
        name: 'Fulana',
        displayName: 'Fulana',
        avatar: '',
        avatarColor: 'green',
      },
    };

    renderSettings({ state, updateProfile });

    const input = screen.getByLabelText('Nome de exibição');
    await user.clear(input);
    await user.type(input, 'Apelido Legal');
    await user.click(screen.getByRole('button', { name: 'Salvar perfil' }));

    expect(updateProfile).toHaveBeenCalledWith({
      avatar: '',
      avatarPoster: '',
      avatarColor: 'green',
      displayName: 'Apelido Legal',
      banner: '',
      bannerPoster: '',
      bio: '',
      profileLinks: [],
    });
  });

  it('salva uma cor personalizada (fora dos presets) escolhida no color picker', async () => {
    const user = userEvent.setup();
    const updateProfile = vi.fn();
    const state = {
      ...initialRoomState,
      me: {
        ...initialRoomState.me,
        id: 'conn-1',
        userId: 'user-1',
        name: 'Fulana',
        displayName: 'Fulana',
        avatar: '',
        avatarColor: 'green',
      },
    };

    renderSettings({ state, updateProfile });

    fireEvent.change(screen.getByLabelText('Escolher cor personalizada'), { target: { value: '#a1b2c3' } });
    await user.click(screen.getByRole('button', { name: 'Salvar perfil' }));

    expect(updateProfile).toHaveBeenCalledWith({
      avatar: '',
      avatarPoster: '',
      avatarColor: '#a1b2c3',
      displayName: 'Fulana',
      banner: '',
      bannerPoster: '',
      bio: '',
      profileLinks: [],
    });
  });

  it('salva bio e links do perfil sem linhas vazias', async () => {
    const user = userEvent.setup();
    const updateProfile = vi.fn();
    const state = {
      ...initialRoomState,
      me: {
        ...initialRoomState.me,
        id: 'conn-1',
        userId: 'user-1',
        name: 'Fulana',
        displayName: 'Fulana',
        avatar: '',
        avatarColor: 'green',
      },
    };

    renderSettings({ state, updateProfile });

    await user.type(screen.getByLabelText('Bio'), 'Oi, eu sou a Fulana.');
    await user.type(screen.getByLabelText('Link 1'), 'https://youtube.com/@fulana');
    await user.click(screen.getByRole('button', { name: 'Adicionar link' }));
    await user.click(screen.getByRole('button', { name: 'Salvar perfil' }));

    expect(updateProfile).toHaveBeenCalledWith({
      avatar: '',
      avatarPoster: '',
      avatarColor: 'green',
      displayName: 'Fulana',
      banner: '',
      bannerPoster: '',
      bio: 'Oi, eu sou a Fulana.',
      profileLinks: ['https://youtube.com/@fulana'],
    });
  });

  it('mostra "Remover foto" so quando ja existe uma foto', async () => {
    const user = userEvent.setup();
    const stateSemFoto = {
      ...initialRoomState,
      me: { ...initialRoomState.me, id: 'conn-1', userId: 'user-1', name: 'Fulana', displayName: 'Fulana', avatar: '', avatarColor: 'green' },
    };
    renderSettings({ state: stateSemFoto });

    await user.click(screen.getByRole('button', { name: 'Alterar foto de perfil' }));
    expect(await screen.findByRole('menuitem', { name: 'Enviar do computador' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Remover foto' })).not.toBeInTheDocument();
  });

  it('recorta e envia uma nova foto de perfil, sem publicar o resto do rascunho (isolado)', async () => {
    const user = userEvent.setup();
    const uploadProfileImage = vi.fn().mockResolvedValue('/uploads/novo-avatar');
    const state = {
      ...initialRoomState,
      me: { ...initialRoomState.me, id: 'conn-1', userId: 'user-1', name: 'Fulana', displayName: 'Fulana', avatar: '', avatarColor: 'green' },
    };
    renderSettings({ state, uploadProfileImage });

    const file = new File(['conteudo'], 'foto.png', { type: 'image/png' });
    await user.upload(screen.getByLabelText('Selecionar foto de perfil'), file);
    await user.click(screen.getByRole('button', { name: 'Confirmar recorte' }));

    // no 5th "current draft" argument — an avatar upload can never carry
    // whatever is currently typed into displayName/bio/color/links
    expect(uploadProfileImage).toHaveBeenCalledWith('avatar', file, { x: 0, y: 0, width: 10, height: 10 }, expect.any(Function));
    expect(uploadProfileImage).not.toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything(), expect.anything(), expect.anything());
  });

  it('remove a foto de perfil por um pedido isolado (nao pelo updateProfile do formulario)', async () => {
    const user = userEvent.setup();
    const removeProfileImage = vi.fn().mockResolvedValue({});
    const updateProfile = vi.fn();
    const state = {
      ...initialRoomState,
      me: { ...initialRoomState.me, id: 'conn-1', userId: 'user-1', name: 'Fulana', displayName: 'Fulana', avatar: '/uploads/foto-atual', avatarColor: 'green' },
    };
    renderSettings({ state, updateProfile, removeProfileImage });

    await user.click(screen.getByRole('button', { name: 'Alterar foto de perfil' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Remover foto' }));

    expect(removeProfileImage).toHaveBeenCalledWith('avatar');
    expect(updateProfile).not.toHaveBeenCalled();
  });

  it('erro ao salvar mostra o motivo e nao trava o formulario', async () => {
    const user = userEvent.setup();
    const updateProfile = vi.fn().mockRejectedValue(new ProfileSaveRefused('rate_limited', 'Você está enviando rápido demais.'));
    const state = { ...initialRoomState, me: { ...initialRoomState.me, id: 'conn-1', userId: 'user-1', name: 'Fulana', displayName: 'Fulana' } };
    renderSettings({ state, updateProfile });

    await user.type(screen.getByLabelText('Bio'), 'edição pendente');
    await user.click(screen.getByRole('button', { name: 'Salvar perfil' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Você está enviando rápido demais.');
    expect(screen.queryByRole('button', { name: 'Perfil salvo' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Salvar perfil' })).toBeEnabled();
  });

  it('sem edicoes, a barra de salvar fica escondida', () => {
    const state = { ...initialRoomState, me: { ...initialRoomState.me, id: 'conn-1', userId: 'user-1', name: 'Fulana', displayName: 'Fulana' } };
    renderSettings({ state });
    expect(screen.queryByRole('button', { name: 'Salvar perfil' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Descartar' })).not.toBeInTheDocument();
  });

  it('com chamada ativa, a barra de salvar sobe para nao ficar atras do PiP flutuante', async () => {
    const user = userEvent.setup();
    const state = { ...initialRoomState, me: { ...initialRoomState.me, id: 'conn-1', userId: 'user-1', name: 'Fulana', displayName: 'Fulana' } };
    renderSettings({ state, activeCallConversationId: 'conv-1' });

    await user.type(screen.getByLabelText('Bio'), 'editando durante a chamada');
    // button -> the "flex gap-2" buttons row -> the bar itself
    const bar = screen.getByRole('button', { name: 'Salvar perfil' }).parentElement?.parentElement;
    // FloatingPip sits fixed at the viewport's bottom-4 left-4 corner —
    // bottom-0 would put this bar's own buttons right under it.
    expect(bar?.className).toContain('bottom-20');
    expect(bar?.className).not.toContain('bottom-0');
  });

  it('sem chamada ativa, a barra de salvar fica no rodape normal', async () => {
    const user = userEvent.setup();
    const state = { ...initialRoomState, me: { ...initialRoomState.me, id: 'conn-1', userId: 'user-1', name: 'Fulana', displayName: 'Fulana' } };
    renderSettings({ state, activeCallConversationId: null });

    await user.type(screen.getByLabelText('Bio'), 'editando sem chamada');
    const bar = screen.getByRole('button', { name: 'Salvar perfil' }).parentElement?.parentElement;
    expect(bar?.className).toContain('bottom-0');
    expect(bar?.className).not.toContain('bottom-20');
  });

  it('descartar volta os campos aos ultimos valores confirmados e esconde a barra', async () => {
    const user = userEvent.setup();
    const state = {
      ...initialRoomState,
      me: { ...initialRoomState.me, id: 'conn-1', userId: 'user-1', name: 'Fulana', displayName: 'Fulana', bio: 'bio original' },
    };
    renderSettings({ state });

    const bio = screen.getByLabelText('Bio');
    await user.type(bio, ' e mais um pedaço');
    await user.click(screen.getByRole('button', { name: 'Descartar' }));

    expect(bio).toHaveValue('bio original');
    expect(screen.queryByRole('button', { name: 'Salvar perfil' })).not.toBeInTheDocument();
  });
});

let mockMode: 'wide' | 'compact' = 'wide';
vi.mock('@/features/settings/useSettingsLayout', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/settings/useSettingsLayout')>()),
  useSettingsLayout: () => mockMode,
}));

function Where() {
  const location = useLocation();
  return <p data-testid="where">{location.pathname}</p>;
}

function renderRouted(overrides: Partial<RoomContextValue> = {}, path = '/app/settings/profile') {
  const router = createMemoryRouter(
    [{ path: '/app/settings/:tab?', element: <><Where /><SettingsPage onOpenProfile={vi.fn()} /></> }],
    { initialEntries: [path] },
  );
  return { ...renderWithRoom(<RouterProvider router={router} />, overrides), router };
}

describe('SettingsPage — navegacao por categorias', () => {
  const adminState = { ...initialRoomState, me: { ...initialRoomState.me, id: 'c', userId: 'u', name: 'Ana', displayName: 'Ana', role: 'admin' as const } };
  const userState = { ...initialRoomState, me: { ...initialRoomState.me, id: 'c', userId: 'u', name: 'Ana', displayName: 'Ana' } };

  beforeEach(() => { mockMode = 'wide'; });

  it('abre a categoria nomeada na URL e a marca como pagina atual', () => {
    renderSettings({ state: userState }, '/app/settings/privacy');
    expect(screen.getByText('lista de bloqueados')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Privacidade' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Perfil' })).not.toHaveAttribute('aria-current');
  });

  it('sem categoria na URL, o modo amplo mostra o Perfil na mesma URL (sem redirecionar)', () => {
    renderRouted({ state: userState }, '/app/settings');
    expect(screen.getByLabelText('Nome de exibição')).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent('/app/settings');
    expect(screen.getByRole('link', { name: 'Perfil' })).toHaveAttribute('aria-current', 'page');
  });

  it('categoria desconhecida cai no perfil em vez de renderizar uma pagina vazia', () => {
    renderRouted({ state: userState }, '/app/settings/naoexiste');
    expect(screen.getByLabelText('Nome de exibição')).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent('/app/settings/profile');
  });

  it('administracao nao aparece para quem nao e admin (nem por URL)', () => {
    renderRouted({ state: userState }, '/app/settings/moderation');
    expect(screen.getByTestId('where')).toHaveTextContent('/app/settings/profile');
    expect(screen.queryByRole('link', { name: 'Administração' })).not.toBeInTheDocument();
  });

  it('admin ve a categoria de administracao', () => {
    renderSettings({ state: adminState });
    expect(screen.getByRole('link', { name: 'Administração' })).toBeInTheDocument();
  });

  it('clicar numa categoria navega para a rota dela', async () => {
    const user = userEvent.setup();
    renderRouted({ state: userState });
    await user.click(screen.getByRole('link', { name: 'Privacidade' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/app/settings/privacy');
    expect(screen.getByText('lista de bloqueados')).toBeInTheDocument();
  });

  it('o botao de salvar fica junto do cartao, no mesmo formulario, sem painel lateral', async () => {
    const user = userEvent.setup();
    renderSettings({ state: userState });
    await user.type(screen.getByLabelText('Bio'), 'edição pendente');
    const form = screen.getByRole('button', { name: 'Salvar perfil' }).closest('form');
    expect(form).not.toBeNull();
    expect(form!.contains(screen.getByLabelText('Nome de exibição'))).toBe(true);
    expect(screen.queryByText('Salvar alterações')).not.toBeInTheDocument();
  });

  it.each([
    ['account', 'Minha conta'], ['av', 'Áudio e vídeo'], ['notifications', 'Notificações'], ['prefs', 'Preferências'], ['privacy', 'Privacidade'],
  ])('a categoria %s abre com o proprio titulo', (tab, title) => {
    renderSettings({ state: userState }, `/app/settings/${tab}`);
    expect(screen.getByRole('heading', { level: 2, name: title })).toBeInTheDocument();
  });

  it('Minha conta lista as secoes em sequencia (sem grade de cards)', () => {
    renderSettings({ state: userState }, '/app/settings/account');
    for (const name of ['Identificação', 'E-mail', 'Armazenamento de anexos', 'Sessão']) {
      expect(screen.getByRole('heading', { level: 3, name })).toBeInTheDocument();
    }
  });
});

describe('SettingsPage — modo compacto (indice e detalhe)', () => {
  const userState = { ...initialRoomState, me: { ...initialRoomState.me, id: 'c', userId: 'u', name: 'Ana', displayName: 'Ana' } };

  beforeEach(() => { mockMode = 'compact'; });
  afterEach(() => { mockMode = 'wide'; });

  it('/app/settings mostra o indice de categorias, sem formulario', () => {
    renderRouted({ state: userState }, '/app/settings');
    expect(screen.getByRole('navigation', { name: 'Categorias de ajustes' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Áudio e vídeo' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Nome de exibição')).not.toBeInTheDocument();
  });

  it('uma categoria abre direto por link, com retorno acessivel ao indice', async () => {
    const user = userEvent.setup();
    renderRouted({ state: userState }, '/app/settings/privacy');
    expect(screen.getByText('lista de bloqueados')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Categorias de ajustes' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Voltar às configurações' }));
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/app\/settings$/);
    expect(screen.getByRole('link', { name: 'Privacidade' })).toBeInTheDocument();
  });

  it('do indice, abrir uma categoria e voltar percorre o historico (nao empilha o indice de novo)', async () => {
    const user = userEvent.setup();
    renderRouted({ state: userState }, '/app/settings');
    await user.click(screen.getByRole('link', { name: 'Privacidade' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/app/settings/privacy');
    await user.click(screen.getByRole('button', { name: 'Voltar às configurações' }));
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/app\/settings$/);
    expect(screen.getByRole('navigation', { name: 'Categorias de ajustes' })).toBeInTheDocument();
  });

  it('o indice nao lista administracao para quem nao e admin', () => {
    renderRouted({ state: userState }, '/app/settings');
    expect(screen.queryByRole('link', { name: 'Administração' })).not.toBeInTheDocument();
  });
});

describe('SettingsPage — bloqueio de navegacao com rascunho de perfil pendente', () => {
  const userState = { ...initialRoomState, me: { ...initialRoomState.me, id: 'conn-1', userId: 'user-1', name: 'Fulana', displayName: 'Fulana', bio: 'bio original' } };

  beforeEach(() => { mockMode = 'wide'; });
  afterEach(() => { mockMode = 'wide'; });

  it('trocar de categoria com rascunho sujo abre o dialogo; continuar editando mantem o rascunho', async () => {
    const user = userEvent.setup();
    renderSettings({ state: userState });
    await user.type(screen.getByLabelText('Bio'), ' e mais');
    await user.click(screen.getByRole('link', { name: 'Minha conta' }));

    expect(await screen.findByText('Alterações não salvas')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Continuar editando' }));
    expect(screen.queryByText('Alterações não salvas')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Bio')).toHaveValue('bio original e mais');
  });

  it('descartar e sair joga fora o rascunho e completa a navegacao', async () => {
    const user = userEvent.setup();
    renderSettings({ state: userState });
    await user.type(screen.getByLabelText('Bio'), ' e mais');
    await user.click(screen.getByRole('link', { name: 'Minha conta' }));
    await screen.findByText('Alterações não salvas');

    await user.click(screen.getByRole('button', { name: 'Descartar e sair' }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Minha conta' })).toBeInTheDocument();
  });

  it('salvar e sair so navega apos confirmar; um erro mantem o dialogo aberto na mesma pagina', async () => {
    const user = userEvent.setup();
    const updateProfile = vi.fn().mockRejectedValue(new ProfileSaveRefused('rate_limited', 'Você está enviando rápido demais.'));
    renderSettings({ state: userState, updateProfile });
    await user.type(screen.getByLabelText('Bio'), ' e mais');
    await user.click(screen.getByRole('link', { name: 'Minha conta' }));
    await screen.findByText('Alterações não salvas');

    await user.click(screen.getByRole('button', { name: 'Salvar e sair' }));
    const dialog = screen.getByRole('dialog');
    expect(await within(dialog).findByText('Você está enviando rápido demais.')).toBeInTheDocument();
    expect(screen.getByText('Alterações não salvas')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2, name: 'Minha conta' })).not.toBeInTheDocument();
  });

  it('sem rascunho sujo, trocar de categoria e instantaneo, sem dialogo', async () => {
    const user = userEvent.setup();
    renderSettings({ state: userState });
    await user.click(screen.getByRole('link', { name: 'Minha conta' }));
    expect(screen.queryByText('Alterações não salvas')).not.toBeInTheDocument();
    expect(await screen.findByRole('heading', { level: 2, name: 'Minha conta' })).toBeInTheDocument();
  });
});

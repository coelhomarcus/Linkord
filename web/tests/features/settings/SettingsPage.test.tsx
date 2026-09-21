import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import userEvent from '@testing-library/user-event';
import { initialRoomState } from '@/state/roomReducer';
import { renderWithRoom } from '@tests/fixtures/roomContextFixture';
import type { RoomContextValue } from '@/state/RoomContext';
import { SettingsPage } from '@/features/settings/SettingsPage';

vi.mock('@/state/AuthContext', () => ({
  useAuth: () => ({ logout: vi.fn() }),
}));

// the page header needs the animated-sidebar provider and the privacy tab
// needs the friends provider — neither is what these tests are about
vi.mock('@/shared/PageHeader', () => ({
  PageHeader: ({ title, leading }: { title: string; leading?: React.ReactNode }) => <header>{leading}<h1>{title}</h1></header>,
}));
vi.mock('@/features/settings/PrivacyTab', () => ({ PrivacyTab: () => <p>lista de bloqueados</p> }));

function renderSettings(overrides: Partial<RoomContextValue> = {}, path = '/app/settings/profile') {
  return renderWithRoom(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/app/settings/:tab?" element={<SettingsPage onOpenProfile={vi.fn()} />} />
      </Routes>
    </MemoryRouter>,
    overrides,
  );
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

  it('recorta e envia uma nova foto de perfil, aplicando na hora (sem esperar Salvar perfil)', async () => {
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

    expect(uploadProfileImage).toHaveBeenCalledWith('avatar', file, { x: 0, y: 0, width: 10, height: 10 }, expect.any(Function), expect.objectContaining({ avatar: '' }));
  });

  it('remove a foto de perfil na hora, sem esperar Salvar perfil', async () => {
    const user = userEvent.setup();
    const updateProfile = vi.fn();
    const state = {
      ...initialRoomState,
      me: { ...initialRoomState.me, id: 'conn-1', userId: 'user-1', name: 'Fulana', displayName: 'Fulana', avatar: '/uploads/foto-atual', avatarColor: 'green' },
    };
    renderSettings({ state, updateProfile });

    await user.click(screen.getByRole('button', { name: 'Alterar foto de perfil' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Remover foto' }));

    expect(updateProfile).toHaveBeenCalledWith(expect.objectContaining({ avatar: '' }));
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
  return renderWithRoom(
    <MemoryRouter initialEntries={[path]}>
      <Where />
      <Routes>
        <Route path="/app/settings/:tab?" element={<SettingsPage onOpenProfile={vi.fn()} />} />
      </Routes>
    </MemoryRouter>,
    overrides,
  );
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

  it('o botao de salvar fica junto do cartao, no mesmo formulario, sem painel lateral', () => {
    renderSettings({ state: userState });
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

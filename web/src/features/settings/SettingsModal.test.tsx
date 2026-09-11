import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { initialRoomState } from '../../state/roomReducer';
import { renderWithRoom } from '../../test/roomContextFixture';
import { SettingsModal } from './SettingsModal';

vi.mock('../../state/AuthContext', () => ({
  useAuth: () => ({ logout: vi.fn() }),
}));

vi.mock('./ImageCropDialog', () => ({
  ImageCropDialog: ({ open, onConfirm, onCancel }: { open: boolean; onConfirm: (crop: { x: number; y: number; width: number; height: number }) => void; onCancel: () => void }) =>
    open ? (
      <div>
        <button type="button" onClick={() => onConfirm({ x: 0, y: 0, width: 10, height: 10 })}>Confirmar recorte</button>
        <button type="button" onClick={onCancel}>Cancelar recorte</button>
      </div>
    ) : null,
}));

describe('SettingsModal — perfil', () => {
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

    renderWithRoom(<SettingsModal open onClose={vi.fn()} />, { state, updateProfile });

    await user.click(screen.getByRole('button', { name: 'Usar Fuchsia' }));
    await user.click(screen.getByRole('button', { name: 'Salvar perfil' }));

    expect(updateProfile).toHaveBeenCalledWith({
      avatar: '',
      avatarColor: 'fuchsia',
      displayName: 'Fulana',
      banner: '',
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

    renderWithRoom(<SettingsModal open onClose={vi.fn()} />, { state, updateProfile });

    const input = screen.getByLabelText('Nome de exibicao');
    await user.clear(input);
    await user.type(input, 'Apelido Legal');
    await user.click(screen.getByRole('button', { name: 'Salvar perfil' }));

    expect(updateProfile).toHaveBeenCalledWith({
      avatar: '',
      avatarColor: 'green',
      displayName: 'Apelido Legal',
      banner: '',
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

    renderWithRoom(<SettingsModal open onClose={vi.fn()} />, { state, updateProfile });

    fireEvent.change(screen.getByLabelText('Escolher cor personalizada'), { target: { value: '#a1b2c3' } });
    await user.click(screen.getByRole('button', { name: 'Salvar perfil' }));

    expect(updateProfile).toHaveBeenCalledWith({
      avatar: '',
      avatarColor: '#a1b2c3',
      displayName: 'Fulana',
      banner: '',
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

    renderWithRoom(<SettingsModal open onClose={vi.fn()} />, { state, updateProfile });

    await user.type(screen.getByLabelText('Bio'), 'Oi, eu sou a Fulana.');
    await user.type(screen.getByLabelText('Link 1'), 'https://youtube.com/@fulana');
    await user.click(screen.getByRole('button', { name: 'Adicionar link' }));
    await user.click(screen.getByRole('button', { name: 'Salvar perfil' }));

    expect(updateProfile).toHaveBeenCalledWith({
      avatar: '',
      avatarColor: 'green',
      displayName: 'Fulana',
      banner: '',
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
    renderWithRoom(<SettingsModal open onClose={vi.fn()} />, { state: stateSemFoto });

    await user.click(screen.getByRole('button', { name: 'Alterar foto de perfil' }));
    expect(await screen.findByRole('menuitem', { name: 'Enviar foto' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Remover foto' })).not.toBeInTheDocument();
  });

  it('recorta e envia uma nova foto de perfil, aplicando na hora (sem esperar Salvar perfil)', async () => {
    const user = userEvent.setup();
    const uploadProfileImage = vi.fn().mockResolvedValue('/uploads/novo-avatar');
    const state = {
      ...initialRoomState,
      me: { ...initialRoomState.me, id: 'conn-1', userId: 'user-1', name: 'Fulana', displayName: 'Fulana', avatar: '', avatarColor: 'green' },
    };
    renderWithRoom(<SettingsModal open onClose={vi.fn()} />, { state, uploadProfileImage });

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
    renderWithRoom(<SettingsModal open onClose={vi.fn()} />, { state, updateProfile });

    await user.click(screen.getByRole('button', { name: 'Alterar foto de perfil' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Remover foto' }));

    expect(updateProfile).toHaveBeenCalledWith(expect.objectContaining({ avatar: '' }));
  });
});

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { initialRoomState } from '../../state/roomReducer';
import { renderWithRoom } from '../../test/roomContextFixture';
import { SettingsModal } from './SettingsModal';

vi.mock('../../state/AuthContext', () => ({
  useAuth: () => ({ logout: vi.fn() }),
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

    const input = screen.getByLabelText('Como voce aparece pra todo mundo');
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

    // userEvent nao simula bem <input type="color"> (nao ha "digitar" num
    // color picker nativo) — um change direto e o jeito certo de testar,
    // igual o proprio browser dispara ao fechar o picker do SO.
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

  it('salva banner, bio e links do perfil sem linhas vazias', async () => {
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

    await user.type(screen.getByLabelText('URL de uma imagem horizontal (opcional)'), 'https://example.com/banner.png');
    await user.type(screen.getByLabelText('Um resumo curto sobre voce'), 'Oi, eu sou a Fulana.');
    await user.type(screen.getByLabelText('Link 1'), 'https://youtube.com/@fulana');
    await user.click(screen.getByRole('button', { name: 'Adicionar link' }));
    await user.click(screen.getByRole('button', { name: 'Salvar perfil' }));

    expect(updateProfile).toHaveBeenCalledWith({
      avatar: '',
      avatarColor: 'green',
      displayName: 'Fulana',
      banner: 'https://example.com/banner.png',
      bio: 'Oi, eu sou a Fulana.',
      profileLinks: ['https://youtube.com/@fulana'],
    });
  });
});

import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
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
        avatar: '',
        avatarColor: 'green',
      },
    };

    renderWithRoom(<SettingsModal open onClose={vi.fn()} />, { state, updateProfile });

    await user.click(screen.getByRole('button', { name: 'Usar Fuchsia' }));
    await user.click(screen.getByRole('button', { name: 'Salvar perfil' }));

    expect(updateProfile).toHaveBeenCalledWith({ avatar: '', avatarColor: 'fuchsia' });
  });
});

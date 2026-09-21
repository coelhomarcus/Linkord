import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PublicUser } from '@/shared/types/protocol';
import { renderWithRoom } from '@tests/fixtures/roomContextFixture';
import { ProfileModal } from '@/features/profile/ProfileModal';

// the relationship actions need the router and the friends provider — they
// have their own tests (tests/features/friends/ProfileActions.test.tsx)
vi.mock('@/features/friends/ProfileActions', () => ({ ProfileActions: () => null }));

const user: PublicUser = {
  id: 'u1',
  username: 'marcus',
  displayName: 'Marcus',
  avatar: '/avatar-small.webp',
  avatarColor: 'blurple',
  banner: '/banner-small.webp',
  bio: '',
  profileLinks: [],
  role: 'user',
};

describe('ProfileModal', () => {
  it('abre PFP e banner na mesma moldura padronizada, identificando a imagem clicada', async () => {
    const interaction = userEvent.setup();
    renderWithRoom(<ProfileModal userId="u1" onClose={vi.fn()} />, {
      allUsers: new Map([[user.id, user]]),
    });

    await interaction.click(screen.getByRole('button', { name: 'Ver foto de perfil em tela cheia' }));
    expect(screen.getByRole('img', { name: 'Foto de perfil' })).toHaveAttribute('src', user.avatar);
    const avatarFrame = document.querySelector<HTMLElement>('[data-slot="image-lightbox-frame"]');
    expect(avatarFrame).toHaveStyle({ width: '80vw', maxWidth: '80vh' });
    expect(avatarFrame?.style.aspectRatio).toBe('1 / 1');

    await interaction.click(screen.getByRole('button', { name: 'Fechar' }));
    await interaction.click(screen.getByRole('button', { name: 'Ver banner em tela cheia' }));
    expect(screen.getByRole('img', { name: 'Banner' })).toHaveAttribute('src', user.banner);
    const bannerFrame = document.querySelector<HTMLElement>('[data-slot="image-lightbox-frame"]');
    expect(bannerFrame).toHaveStyle({ width: '80vw', maxWidth: `${(80 * 16) / 9}vh` });
    expect(bannerFrame?.style.aspectRatio).toBe(`${16 / 9} / 1`);
  });

  it('mantém a identificação correta quando avatar e banner usam a mesma URL', async () => {
    const interaction = userEvent.setup();
    const sameUrlUser = { ...user, avatar: '/same-image.webp', banner: '/same-image.webp' };
    renderWithRoom(<ProfileModal userId="u1" onClose={vi.fn()} />, {
      allUsers: new Map([[sameUrlUser.id, sameUrlUser]]),
    });

    await interaction.click(screen.getByRole('button', { name: 'Ver banner em tela cheia' }));
    expect(screen.getByRole('img', { name: 'Banner' })).toHaveAttribute('src', sameUrlUser.banner);
  });
});

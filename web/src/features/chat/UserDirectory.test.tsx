import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRoom } from '../../test/roomContextFixture';
import { UserDirectory } from './UserDirectory';
import type { PublicUser } from '../../types/protocol';

function user(overrides: Partial<PublicUser> = {}): PublicUser {
  return {
    id: 'u1',
    username: 'fulana',
    displayName: 'Fulana',
    avatar: '',
    avatarColor: 'green',
    banner: '',
    bio: '',
    profileLinks: [],
    role: 'user',
    ...overrides,
  };
}

describe('UserDirectory', () => {
  it('abre o perfil ao clicar num usuario da sidebar direita', async () => {
    const onOpenProfile = vi.fn();
    const member = user();

    renderWithRoom(
      <UserDirectory mobileOpen={false} onMobileClose={() => {}} onOpenProfile={onOpenProfile} />,
      {
        allUsers: new Map([[member.id, member]]),
        onlineUserIds: new Set([member.id]),
      }
    );

    await userEvent.click(screen.getByRole('button', { name: 'Abrir perfil de Fulana' }));

    expect(onOpenProfile).toHaveBeenCalledWith('u1');
  });
});

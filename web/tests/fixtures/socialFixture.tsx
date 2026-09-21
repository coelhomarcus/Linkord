import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router';
import type { RenderResult } from '@testing-library/react';
import type { RoomContextValue } from '@/state/RoomContext';
import { FriendsProvider } from '@/features/friends/FriendsContext';
import { renderWithRoom } from './roomContextFixture';

/** Router + room + friends provider around a social screen. Tests that use it
 * mock '@/shared/api/api' themselves — the provider fetches the request
 * summary on mount. */
export function renderSocial(
  ui: ReactElement,
  { room = {}, path = '/' }: { room?: Partial<RoomContextValue>; path?: string } = {},
): RenderResult {
  return renderWithRoom(
    <MemoryRouter initialEntries={[path]}>
      <FriendsProvider>{ui}</FriendsProvider>
    </MemoryRouter>,
    room,
  );
}

export const ana = { id: 'u-ana', username: 'ana', displayName: 'Ana', avatar: '', avatarColor: 'blurple' };
export const bea = { id: 'u-bea', username: 'bea', displayName: 'Bea', avatar: '', avatarColor: 'green' };

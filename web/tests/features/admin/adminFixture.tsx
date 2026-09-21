import type { ReactElement } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import type { RenderResult } from '@testing-library/react';
import type { RoomContextValue } from '@/state/RoomContext';
import { initialRoomState } from '@/state/roomReducer';
import { renderWithRoom } from '@tests/fixtures/roomContextFixture';

export function adminRoom(role: 'admin' | 'user' = 'admin', userId = 'admin-1'): Partial<RoomContextValue> {
  return { state: { ...initialRoomState, me: { ...initialRoomState.me, userId, role } } };
}

/** Renders `ui` at `path`, matched by `pattern` so useParams works. */
export function renderAdmin(ui: ReactElement, { path, pattern, room = adminRoom() }: { path: string; pattern: string; room?: Partial<RoomContextValue> }): RenderResult {
  return renderWithRoom(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={pattern} element={ui} />
        <Route path="*" element={<p>outra rota</p>} />
      </Routes>
    </MemoryRouter>,
    room,
  );
}

export const auditRow = (over: Record<string, unknown> = {}) => ({
  id: 'a1', at: '2026-01-01T10:00:00.000Z', actorId: 'admin-1', actorLabel: 'lune', action: 'user.suspend', targetType: 'user',
  targetId: 'u1', targetLabel: 'ana', reason: 'spam em massa', result: 'ok' as const, detail: {}, requestId: 'req-1', ...over,
});

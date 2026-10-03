import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RoomContext } from '@/state/RoomContext';
import { createFakeRoomContextValue } from '@tests/fixtures/roomContextFixture';
import { NotificationsSettings } from '@/features/settings/NotificationsSettings';

class FakeNotification {
  static permission: NotificationPermission = 'default';
  static requestPermission = vi.fn(async (): Promise<NotificationPermission> => 'granted');
}

const playSound = vi.fn();
vi.mock('@/shared/sounds', () => ({ playSound: (...args: unknown[]) => playSound(...args) }));

function renderNotifications(overrides: Parameters<typeof createFakeRoomContextValue>[0] = {}) {
  return render(
    <RoomContext.Provider value={createFakeRoomContextValue(overrides)}>
      <NotificationsSettings />
    </RoomContext.Provider>,
  );
}

beforeEach(() => {
  FakeNotification.permission = 'default';
  FakeNotification.requestPermission.mockClear().mockResolvedValue('granted');
  vi.stubGlobal('Notification', FakeNotification);
  playSound.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('NotificationsSettings', () => {
  it('preference saved as true, but without permission granted: the switch does not appear on', () => {
    renderNotifications({ notificationsEnabled: true });
    expect(screen.getByRole('switch', { name: 'Notificações de mensagens' })).not.toBeChecked();
    expect(screen.getByText(/Permissão necessária/)).toBeInTheDocument();
  });

  it('permission denied: shows the reason, without offering to ask again', async () => {
    FakeNotification.permission = 'denied';
    const user = userEvent.setup();
    renderNotifications({ notificationsEnabled: true });
    expect(screen.getByText(/Bloqueadas no navegador/)).toBeInTheDocument();

    await user.click(screen.getByRole('switch', { name: 'Notificações de mensagens' }));
    expect(FakeNotification.requestPermission).not.toHaveBeenCalled();
    expect(await screen.findByRole('alert')).toHaveTextContent('Notificações bloqueadas');
  });

  it('enabling with permission not yet requested: asks only on the gesture and turns on if granted', async () => {
    const setNotificationsEnabled = vi.fn();
    const user = userEvent.setup();
    renderNotifications({ notificationsEnabled: false, setNotificationsEnabled });
    expect(FakeNotification.requestPermission).not.toHaveBeenCalled();

    await user.click(screen.getByRole('switch', { name: 'Notificações de mensagens' }));
    expect(FakeNotification.requestPermission).toHaveBeenCalledTimes(1);
    expect(setNotificationsEnabled).toHaveBeenCalledWith(true);
  });

  it('permission granted and preference on: switch appears on, without a status warning', () => {
    FakeNotification.permission = 'granted';
    renderNotifications({ notificationsEnabled: true });
    expect(screen.getByRole('switch', { name: 'Notificações de mensagens' })).toBeChecked();
    expect(screen.queryByText(/Permissão necessária|Bloqueadas|não disponíveis/i)).not.toBeInTheDocument();
  });

  it('no Notification support: shows its own state when trying to turn on', async () => {
    vi.unstubAllGlobals();
    const user = userEvent.setup();
    renderNotifications({ notificationsEnabled: false });
    expect(screen.getByText(/Não disponíveis/)).toBeInTheDocument();

    await user.click(screen.getByRole('switch', { name: 'Notificações de mensagens' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('não suporta notificações');
  });

  it('testing the sound plays the new-message sound, without a real notification', async () => {
    const user = userEvent.setup();
    renderNotifications();
    await user.click(screen.getByRole('button', { name: 'Testar som' }));
    expect(playSound).toHaveBeenCalledWith('newMessage');
  });

  it('revoking permission and coming back to the page re-evaluates the state (visibilitychange)', async () => {
    renderNotifications({ notificationsEnabled: true });
    FakeNotification.permission = 'granted';
    document.dispatchEvent(new Event('visibilitychange'));
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Notificações de mensagens' })).toBeChecked());
  });
});

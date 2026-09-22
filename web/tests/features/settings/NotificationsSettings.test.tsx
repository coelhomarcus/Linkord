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
  it('preferencia salva como true, mas sem permissao concedida: o switch nao aparenta estar ligado', () => {
    renderNotifications({ notificationsEnabled: true });
    expect(screen.getByRole('switch', { name: 'Notificações de mensagens' })).not.toBeChecked();
    expect(screen.getByText(/Permissão necessária/)).toBeInTheDocument();
  });

  it('permissao negada: mostra o motivo, sem oferecer pedir de novo', async () => {
    FakeNotification.permission = 'denied';
    const user = userEvent.setup();
    renderNotifications({ notificationsEnabled: true });
    expect(screen.getByText(/Bloqueadas no navegador/)).toBeInTheDocument();

    await user.click(screen.getByRole('switch', { name: 'Notificações de mensagens' }));
    expect(FakeNotification.requestPermission).not.toHaveBeenCalled();
    expect(await screen.findByRole('alert')).toHaveTextContent('Notificações bloqueadas');
  });

  it('ativar com permissao ainda nao pedida: pede so no gesto e liga se concedida', async () => {
    const setNotificationsEnabled = vi.fn();
    const user = userEvent.setup();
    renderNotifications({ notificationsEnabled: false, setNotificationsEnabled });
    expect(FakeNotification.requestPermission).not.toHaveBeenCalled();

    await user.click(screen.getByRole('switch', { name: 'Notificações de mensagens' }));
    expect(FakeNotification.requestPermission).toHaveBeenCalledTimes(1);
    expect(setNotificationsEnabled).toHaveBeenCalledWith(true);
  });

  it('permissao concedida e preferencia ligada: switch aparece ligado, sem aviso de estado', () => {
    FakeNotification.permission = 'granted';
    renderNotifications({ notificationsEnabled: true });
    expect(screen.getByRole('switch', { name: 'Notificações de mensagens' })).toBeChecked();
    expect(screen.queryByText(/Permissão necessária|Bloqueadas|não disponíveis/i)).not.toBeInTheDocument();
  });

  it('sem suporte a Notification: mostra estado proprio ao tentar ligar', async () => {
    vi.unstubAllGlobals();
    const user = userEvent.setup();
    renderNotifications({ notificationsEnabled: false });
    expect(screen.getByText(/Não disponíveis/)).toBeInTheDocument();

    await user.click(screen.getByRole('switch', { name: 'Notificações de mensagens' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('não suporta notificações');
  });

  it('testar som toca o som de nova mensagem, sem notificacao real', async () => {
    const user = userEvent.setup();
    renderNotifications();
    await user.click(screen.getByRole('button', { name: 'Testar som' }));
    expect(playSound).toHaveBeenCalledWith('newMessage');
  });

  it('revogar a permissao e voltar pra pagina reavalia o estado (visibilitychange)', async () => {
    renderNotifications({ notificationsEnabled: true });
    FakeNotification.permission = 'granted';
    document.dispatchEvent(new Event('visibilitychange'));
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Notificações de mensagens' })).toBeChecked());
  });
});

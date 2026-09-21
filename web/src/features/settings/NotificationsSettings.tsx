import { useState } from 'react';
import { useRoom } from '@/state/RoomContext';
import { requestNotificationPermission } from '@/shared/notifications';
import { Slider } from '@/shared/ui/primitives/slider';
import { Switch } from '@/shared/ui/primitives/switch';
import { SettingsRow, SettingsSection, SettingsSections } from './SettingsLayout';

export function NotificationsSettings() {
  const { notifyVolume, setNotifyVolume, notificationsEnabled, setNotificationsEnabled } = useRoom();
  const [notificationsError, setNotificationsError] = useState<string | null>(null);

  function handleVolumeChange(value: number | readonly number[]) {
    const v = Array.isArray(value) ? (value[0] ?? 0) : (value as number);
    setNotifyVolume(v / 100);
  }

  async function handleToggleNotifications(checked: boolean) {
    if (!checked) {
      setNotificationsError(null);
      setNotificationsEnabled(false);
      return;
    }
    if (typeof Notification === 'undefined') {
      setNotificationsError('Seu navegador não suporta notificações.');
      return;
    }
    const permission = Notification.permission === 'default' ? await requestNotificationPermission() : Notification.permission;
    if (permission === 'granted') {
      setNotificationsError(null);
      setNotificationsEnabled(true);
    } else {
      setNotificationsError('Notificações bloqueadas. Permita o acesso nas configurações do navegador para habilitar.');
    }
  }

  const percent = Math.round(notifyVolume * 100);

  return (
    <SettingsSections>
      <SettingsSection id="system" title="Notificações do sistema">
        <SettingsRow label="Notificações de mensagens" description="Avisa no sistema quando chegar mensagem em uma conversa que você não está vendo.">
          <Switch checked={notificationsEnabled} onCheckedChange={handleToggleNotifications} aria-label="Notificações de mensagens" />
        </SettingsRow>
        {notificationsError && <p role="alert" className="text-label text-red">{notificationsError}</p>}
      </SettingsSection>

      <SettingsSection id="sounds" title="Sons">
        <SettingsRow label="Volume das notificações" description="Mutar/desmutar, ensurdecer, entrar/sair da chamada, câmera, tela e mensagem nova.">
          <span className="text-label tabular-nums text-text-muted">{percent === 0 ? 'Mudo' : `${percent}%`}</span>
        </SettingsRow>
        <Slider aria-label="Volume das notificações" value={[percent]} onValueChange={handleVolumeChange} min={0} max={100} />
      </SettingsSection>
    </SettingsSections>
  );
}

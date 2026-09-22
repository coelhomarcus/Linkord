import { useEffect, useState } from 'react';
import { useRoom } from '@/state/RoomContext';
import { notificationPermissionState, requestNotificationPermission } from '@/shared/notifications';
import type { NotificationPermissionState } from '@/shared/notifications';
import { playSound } from '@/shared/sounds';
import { Slider } from '@/shared/ui/primitives/slider';
import { Switch } from '@/shared/ui/primitives/switch';
import { Button } from '@/shared/ui/primitives/button';
import { SettingsRow, SettingsSection, SettingsSections } from './SettingsLayout';

const STATUS_TEXT: Record<Exclude<NotificationPermissionState, 'granted'>, string> = {
  default: 'Permissão necessária — o navegador vai perguntar quando você ativar.',
  denied: 'Bloqueadas no navegador. Permita o acesso nas configurações do navegador pra este site.',
  unsupported: 'Não disponíveis neste navegador.',
};

export function NotificationsSettings() {
  const { notifyVolume, setNotifyVolume, notificationsEnabled, setNotificationsEnabled } = useRoom();
  const [notificationsError, setNotificationsError] = useState<string | null>(null);
  const [permission, setPermission] = useState<NotificationPermissionState>(() => notificationPermissionState());

  // The browser permission can change behind the app's back — revoked from
  // the browser's own settings, for instance — so a value read once at
  // mount would go stale. Re-read whenever the tab becomes visible/focused
  // again instead of trusting that first snapshot forever.
  useEffect(() => {
    function reevaluate() { setPermission(notificationPermissionState()); }
    window.addEventListener('focus', reevaluate);
    document.addEventListener('visibilitychange', reevaluate);
    return () => {
      window.removeEventListener('focus', reevaluate);
      document.removeEventListener('visibilitychange', reevaluate);
    };
  }, []);

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
    if (permission === 'unsupported') {
      setNotificationsError('Seu navegador não suporta notificações.');
      return;
    }
    // Only actually asks (a real permission prompt) on 'default' — the
    // gesture requirement is satisfied by this being a click handler, but
    // asking again after 'denied' would never re-prompt, only waste it.
    const result = permission === 'default' ? await requestNotificationPermission() : permission;
    setPermission(result);
    if (result === 'granted') {
      setNotificationsError(null);
      setNotificationsEnabled(true);
    } else {
      setNotificationsError('Notificações bloqueadas. Permita o acesso nas configurações do navegador para habilitar.');
    }
  }

  const percent = Math.round(notifyVolume * 100);
  // The preference alone is never enough to claim notifications are really
  // on — without the browser's permission they plainly aren't, whatever
  // was saved. The preference itself is left untouched so it can resume on
  // its own the moment permission is granted again.
  const effectivelyOn = notificationsEnabled && permission === 'granted';

  return (
    <SettingsSections>
      <SettingsSection id="system" title="Notificações do sistema">
        <SettingsRow label="Notificações de mensagens" description="Avisa no sistema quando chegar mensagem em uma conversa que você não está vendo.">
          <Switch checked={effectivelyOn} onCheckedChange={(v) => void handleToggleNotifications(v)} aria-label="Notificações de mensagens" />
        </SettingsRow>
        {permission !== 'granted' && <p className="text-label text-text-muted">{STATUS_TEXT[permission]}</p>}
        {notificationsError && <p role="alert" className="text-label text-red">{notificationsError}</p>}
      </SettingsSection>

      <SettingsSection id="sounds" title="Sons">
        <SettingsRow label="Volume das notificações" description="Mutar/desmutar, ensurdecer, entrar/sair da chamada, câmera, tela e mensagem nova.">
          <span className="text-label tabular-nums text-text-muted">{percent === 0 ? 'Mudo' : `${percent}%`}</span>
        </SettingsRow>
        <Slider aria-label="Volume das notificações" value={[percent]} onValueChange={handleVolumeChange} min={0} max={100} />
        <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => playSound('newMessage')}>
          <span>Testar som</span>
        </Button>
      </SettingsSection>
    </SettingsSections>
  );
}

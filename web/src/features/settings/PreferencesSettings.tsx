import { useRoom } from '@/state/RoomContext';
import { Switch } from '@/shared/ui/primitives/switch';
import { SettingsRow, SettingsSection, SettingsSections } from './SettingsLayout';

export function PreferencesSettings() {
  const { showTileBanners, setShowTileBanners, showStats, setShowStats } = useRoom();

  return (
    <SettingsSections>
      <SettingsSection id="call-appearance" title="Aparência da chamada">
        <SettingsRow label="Mostrar banners dos participantes" description="Exibe o banner do perfil como fundo dos cartões da chamada.">
          <Switch checked={showTileBanners} onCheckedChange={setShowTileBanners} aria-label="Mostrar banners nos tiles" />
        </SettingsRow>
        <SettingsRow label="Mostrar estatísticas" description="Bitrate e tempo no ar no menu de cada transmissão.">
          <Switch checked={showStats} onCheckedChange={setShowStats} aria-label="Mostrar estatísticas" />
        </SettingsRow>
      </SettingsSection>
    </SettingsSections>
  );
}

import { useRoom } from '@/state/RoomContext';
import { Switch } from '@/shared/ui/primitives/switch';
import { DevicePicker } from './DevicePicker';
import { SettingsRow, SettingsSection, SettingsSections } from './SettingsLayout';

export function AudioVideoSettings() {
  const { livekitRoom, noiseSuppressionEnabled, setNoiseSuppressionEnabled } = useRoom();

  return (
    <SettingsSections>
      <SettingsSection id="microphone" title="Entrada de áudio">
        <DevicePicker label="Microfone" room={livekitRoom} kind="audioinput" />
      </SettingsSection>

      <SettingsSection id="voice-processing" title="Processamento de voz">
        <SettingsRow label="Supressão de ruído" description="Reduz ruído de fundo (teclado, ventilador, trânsito) no seu microfone.">
          <Switch checked={noiseSuppressionEnabled} onCheckedChange={setNoiseSuppressionEnabled} aria-label="Supressão de ruído" />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection id="speaker" title="Saída de áudio">
        <DevicePicker label="Alto-falante" room={livekitRoom} kind="audiooutput" />
      </SettingsSection>

      <SettingsSection id="camera" title="Vídeo">
        <DevicePicker label="Câmera" room={livekitRoom} kind="videoinput" />
      </SettingsSection>
    </SettingsSections>
  );
}

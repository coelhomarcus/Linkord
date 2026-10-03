import { useNavigate } from 'react-router';
import { ChevronDown, FlipHorizontal, Pause, Play, RefreshCw, Settings } from 'lucide-react';
import type { Room } from 'livekit-client';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuOptionItem, DropdownMenuRadioGroup, DropdownMenuSeparator, DropdownMenuSwitchItem, DropdownMenuTrigger,
} from '@/shared/ui/primitives/dropdown-menu';
import { useMediaDevices } from '@/features/settings/useMediaDevices';
import { useRoom } from '@/state/RoomContext';
import { useParticipantMedia } from './useLiveKitTrack';
import { SHARE_QUALITY_PRESETS } from './shareQualityPresets';
import type { ShareQualityId } from './shareQualityPresets';
import { ROUTES } from '@/shared/lib/routes';
import { cn } from '@/shared/lib/utils';

// 17x17, offset -2px top/right of the 44px main button it sits on — see the
// calls redesign plan §4. Same black/white-based material as the bar itself,
// not the app's theme.
const CORNER_TRIGGER = 'absolute -right-0.5 -top-0.5 z-10 grid size-[17px] place-items-center rounded-[7px] bg-black text-white/70 ring-1 ring-white/15 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60';

// The anchor is the 17px corner trigger, so without an explicit width the
// popup falls back to its min-width and squeezes device names.
const MENU_CONTENT = 'w-80 max-w-[calc(100vw-1.5rem)] p-1.5';
const MENU_LABEL = 'px-2 pb-1 pt-2 text-caption font-semibold uppercase tracking-wide';
const MENU_NOTE = 'px-2 py-2 text-label text-text-muted';

function DeviceRadioList({ room, kind, heading, label }: { room: Room; kind: MediaDeviceKind; heading: string; label: string }) {
  // Only enumerates (silent, no getUserMedia) — opening this menu never
  // starts a capture on its own; requestPermission below is the one
  // explicit gesture that does.
  const { devices, activeDeviceId, status, switching, error, selectDevice, requestPermission } = useMediaDevices(room, kind);

  return (
    <DropdownMenuGroup>
      <DropdownMenuLabel className={MENU_LABEL}>{heading}</DropdownMenuLabel>
      {status === 'permission-needed' ? (
        <DropdownMenuItem className="px-2 py-2" onClick={() => void requestPermission()}>Permitir acesso aos dispositivos</DropdownMenuItem>
      ) : status === 'unsupported' || status === 'permission-denied' ? (
        <p className={MENU_NOTE}>Não foi possível listar dispositivos.</p>
      ) : status === 'no-devices' ? (
        <p className={MENU_NOTE}>Nenhum dispositivo encontrado.</p>
      ) : (
        <>
          <DropdownMenuRadioGroup aria-label={label} value={activeDeviceId} onValueChange={(v) => { if (v) void selectDevice(v as string); }}>
            {devices.map((d) => (
              <DropdownMenuOptionItem key={d.deviceId} value={d.deviceId} disabled={switching}>
                {d.label || 'Dispositivo sem nome'}
              </DropdownMenuOptionItem>
            ))}
          </DropdownMenuRadioGroup>
          {error && <p role="alert" className="px-2 py-2 text-label text-red">{error}</p>}
        </>
      )}
    </DropdownMenuGroup>
  );
}

function SettingsShortcutItem() {
  const navigate = useNavigate();
  // Leaving the stage's route doesn't end the call — FloatingPip takes over
  // (see App.tsx's showStage/inCall split), same as opening any other page.
  return (
    <DropdownMenuItem className="px-2 py-2 text-text-secondary" onClick={() => navigate(ROUTES.settingsTab('av'))}>
      <Settings size={14} />
      Configurações completas
    </DropdownMenuItem>
  );
}

export function MicQuickMenu({ className }: { className?: string }) {
  const { livekitRoom, noiseSuppressionEnabled, setNoiseSuppressionEnabled, noiseSuppressionPending, fullscreenElement } = useRoom();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label="Configurações do microfone" className={cn(CORNER_TRIGGER, className)}>
        <ChevronDown size={10} />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" container={fullscreenElement ?? undefined} className={MENU_CONTENT}>
        <DeviceRadioList room={livekitRoom} kind="audioinput" heading="Entrada de áudio" label="Microfone" />
        <DropdownMenuSeparator />
        <DropdownMenuSwitchItem
          checked={noiseSuppressionEnabled}
          disabled={noiseSuppressionPending}
          onCheckedChange={(value) => void setNoiseSuppressionEnabled(value)}
        >
          Supressão de ruído
        </DropdownMenuSwitchItem>
        <DropdownMenuSeparator />
        <SettingsShortcutItem />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function SpeakerQuickMenu({ className }: { className?: string }) {
  const { livekitRoom, fullscreenElement } = useRoom();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label="Configurações de saída de áudio" className={cn(CORNER_TRIGGER, className)}>
        <ChevronDown size={10} />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" container={fullscreenElement ?? undefined} className={MENU_CONTENT}>
        <DeviceRadioList room={livekitRoom} kind="audiooutput" heading="Saída de áudio" label="Alto-falante" />
        <DropdownMenuSeparator />
        <SettingsShortcutItem />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ScreenShareQuickMenu({ className }: { className?: string }) {
  const { state, shareQuality, setShareQuality, changeSource, pauseSharePreview, resumeSharePreview, fullscreenElement } = useRoom();
  const sharing = state.me.sharing;
  const myMedia = useParticipantMedia(state.me.id ?? '');
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label="Configurações de compartilhamento de tela" className={cn(CORNER_TRIGGER, className)}>
        <ChevronDown size={10} />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" container={fullscreenElement ?? undefined} className={MENU_CONTENT}>
        <DropdownMenuGroup>
          <DropdownMenuLabel className={MENU_LABEL}>Qualidade</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={shareQuality} onValueChange={(v) => { if (v) setShareQuality(v as ShareQualityId); }}>
            {(Object.entries(SHARE_QUALITY_PRESETS) as [ShareQualityId, typeof SHARE_QUALITY_PRESETS[ShareQualityId]][]).map(([id, preset]) => (
              <DropdownMenuOptionItem key={id} value={id}>{preset.label}</DropdownMenuOptionItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        {sharing && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="px-2 py-2" onClick={() => void changeSource()}>
              <RefreshCw size={14} />
              Trocar fonte
            </DropdownMenuItem>
            <DropdownMenuItem className="px-2 py-2" onClick={() => void (myMedia.screenPaused ? resumeSharePreview() : pauseSharePreview())}>
              {myMedia.screenPaused ? <Play size={14} /> : <Pause size={14} />}
              {myMedia.screenPaused ? 'Retomar prévia' : 'Pausar prévia'}
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuSeparator />
        <SettingsShortcutItem />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function CameraQuickMenu({ className }: { className?: string }) {
  const { livekitRoom, mirrorCameraPreview, setMirrorCameraPreview, fullscreenElement } = useRoom();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label="Configurações da câmera" className={cn(CORNER_TRIGGER, className)}>
        <ChevronDown size={10} />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" container={fullscreenElement ?? undefined} className={MENU_CONTENT}>
        <DeviceRadioList room={livekitRoom} kind="videoinput" heading="Câmera" label="Câmera" />
        <DropdownMenuSeparator />
        <DropdownMenuSwitchItem checked={mirrorCameraPreview} onCheckedChange={setMirrorCameraPreview}>
          <FlipHorizontal size={14} />
          Espelhar minha prévia
        </DropdownMenuSwitchItem>
        <DropdownMenuSeparator />
        <SettingsShortcutItem />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

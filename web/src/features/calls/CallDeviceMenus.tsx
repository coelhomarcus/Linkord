import { useNavigate } from 'react-router';
import { ChevronDown, FlipHorizontal, Settings } from 'lucide-react';
import type { Room } from 'livekit-client';
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/shared/ui/primitives/dropdown-menu';
import { useMediaDevices } from '@/features/settings/useMediaDevices';
import { useRoom } from '@/state/RoomContext';
import { ROUTES } from '@/shared/lib/routes';
import { cn } from '@/shared/lib/utils';

// 17x17, offset -2px top/right of the 44px main button it sits on — see the
// calls redesign plan §4. Same black/white-based material as the bar itself,
// not the app's theme.
const CORNER_TRIGGER = 'absolute -right-0.5 -top-0.5 z-10 grid size-[17px] place-items-center rounded-[7px] bg-black text-white/70 ring-1 ring-white/15 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60';

function DeviceRadioList({ room, kind, heading, label }: { room: Room; kind: MediaDeviceKind; heading: string; label: string }) {
  // Only enumerates (silent, no getUserMedia) — opening this menu never
  // starts a capture on its own; requestPermission below is the one
  // explicit gesture that does.
  const { devices, activeDeviceId, status, switching, error, selectDevice, requestPermission } = useMediaDevices(room, kind);

  return (
    <DropdownMenuGroup>
      <DropdownMenuLabel>{heading}</DropdownMenuLabel>
      {status === 'permission-needed' ? (
        <DropdownMenuItem onClick={() => void requestPermission()}>Permitir acesso aos dispositivos</DropdownMenuItem>
      ) : status === 'unsupported' || status === 'permission-denied' ? (
        <p className="px-1.5 py-1 text-label text-text-muted">Não foi possível listar dispositivos.</p>
      ) : status === 'no-devices' ? (
        <p className="px-1.5 py-1 text-label text-text-muted">Nenhum dispositivo encontrado.</p>
      ) : (
        <>
          <DropdownMenuRadioGroup aria-label={label} value={activeDeviceId} onValueChange={(v) => { if (v) void selectDevice(v as string); }}>
            {devices.map((d) => (
              <DropdownMenuRadioItem key={d.deviceId} value={d.deviceId} disabled={switching}>
                {d.label || 'Dispositivo sem nome'}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          {error && <p role="alert" className="px-1.5 py-1 text-label text-red">{error}</p>}
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
    <DropdownMenuItem onClick={() => navigate(ROUTES.settingsTab('av'))}>
      <Settings size={14} />
      Configurações completas
    </DropdownMenuItem>
  );
}

export function MicQuickMenu({ className }: { className?: string }) {
  const { livekitRoom, noiseSuppressionEnabled, setNoiseSuppressionEnabled, noiseSuppressionPending } = useRoom();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label="Configurações do microfone" className={cn(CORNER_TRIGGER, className)}>
        <ChevronDown size={10} />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start">
        <DeviceRadioList room={livekitRoom} kind="audioinput" heading="Entrada de áudio" label="Microfone" />
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem
          checked={noiseSuppressionEnabled}
          disabled={noiseSuppressionPending}
          onCheckedChange={(value) => void setNoiseSuppressionEnabled(value)}
        >
          Supressão de ruído
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <SettingsShortcutItem />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function SpeakerQuickMenu({ className }: { className?: string }) {
  const { livekitRoom } = useRoom();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label="Configurações de saída de áudio" className={cn(CORNER_TRIGGER, className)}>
        <ChevronDown size={10} />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start">
        <DeviceRadioList room={livekitRoom} kind="audiooutput" heading="Saída de áudio" label="Alto-falante" />
        <DropdownMenuSeparator />
        <SettingsShortcutItem />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function CameraQuickMenu({ className }: { className?: string }) {
  const { livekitRoom, mirrorCameraPreview, setMirrorCameraPreview } = useRoom();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label="Configurações da câmera" className={cn(CORNER_TRIGGER, className)}>
        <ChevronDown size={10} />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start">
        <DeviceRadioList room={livekitRoom} kind="videoinput" heading="Câmera" label="Câmera" />
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem checked={mirrorCameraPreview} onCheckedChange={setMirrorCameraPreview}>
          <FlipHorizontal size={14} />
          Espelhar minha prévia
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <SettingsShortcutItem />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

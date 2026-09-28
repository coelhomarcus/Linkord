import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Room } from 'livekit-client';
import type { Room as LKRoom } from 'livekit-client';
import { renderWithRoom } from '@tests/fixtures/roomContextFixture';
import { CameraQuickMenu, MicQuickMenu, SpeakerQuickMenu } from '@/features/calls/CallDeviceMenus';

const navigate = vi.fn();
vi.mock('react-router', () => ({ useNavigate: () => navigate }));

Object.defineProperty(navigator, 'mediaDevices', { value: new EventTarget(), configurable: true });

beforeEach(() => {
  vi.restoreAllMocks();
  navigate.mockClear();
});

function fakeLivekitRoom(activeDeviceId: string | undefined = undefined) {
  const room = {
    getActiveDevice: vi.fn(() => activeDeviceId),
    switchActiveDevice: vi.fn(async () => undefined),
  };
  return room as typeof room & LKRoom;
}

describe('MicQuickMenu', () => {
  it('lista os microfones e troca o ativo ao escolher outro', async () => {
    const user = userEvent.setup();
    vi.spyOn(Room, 'getLocalDevices').mockResolvedValue([
      { deviceId: 'd1', label: 'Microfone interno', kind: 'audioinput' } as MediaDeviceInfo,
      { deviceId: 'd2', label: 'Fone USB', kind: 'audioinput' } as MediaDeviceInfo,
    ]);
    const livekitRoom = fakeLivekitRoom('d1');
    renderWithRoom(<MicQuickMenu />, { livekitRoom });

    await user.click(screen.getByRole('button', { name: 'Configurações do microfone' }));
    await screen.findByText('Fone USB');
    await user.click(screen.getByText('Fone USB'));

    await waitFor(() => expect(livekitRoom.switchActiveDevice).toHaveBeenCalledWith('audioinput', 'd2'));
  });

  it('abrir o menu nao chama getUserMedia (so enumera em silencio)', async () => {
    const user = userEvent.setup();
    vi.spyOn(Room, 'getLocalDevices').mockResolvedValue([{ deviceId: 'd1', label: 'Mic', kind: 'audioinput' } as MediaDeviceInfo]);
    const livekitRoom = fakeLivekitRoom('d1');
    renderWithRoom(<MicQuickMenu />, { livekitRoom });

    await user.click(screen.getByRole('button', { name: 'Configurações do microfone' }));
    await screen.findByText('Mic');

    expect(Room.getLocalDevices).toHaveBeenCalledWith('audioinput', false);
  });

  it('supressao de ruido: mostra o estado atual e aciona o setter da sala', async () => {
    const user = userEvent.setup();
    vi.spyOn(Room, 'getLocalDevices').mockResolvedValue([{ deviceId: 'd1', label: 'Mic', kind: 'audioinput' } as MediaDeviceInfo]);
    const setNoiseSuppressionEnabled = vi.fn(async () => {});
    renderWithRoom(<MicQuickMenu />, { livekitRoom: fakeLivekitRoom('d1'), noiseSuppressionEnabled: false, setNoiseSuppressionEnabled });

    await user.click(screen.getByRole('button', { name: 'Configurações do microfone' }));
    const toggle = await screen.findByText('Supressão de ruído');
    await user.click(toggle);

    expect(setNoiseSuppressionEnabled).toHaveBeenCalledWith(true);
  });

  it('atalho de configuracoes completas navega pra aba de audio e video', async () => {
    const user = userEvent.setup();
    vi.spyOn(Room, 'getLocalDevices').mockResolvedValue([{ deviceId: 'd1', label: 'Mic', kind: 'audioinput' } as MediaDeviceInfo]);
    renderWithRoom(<MicQuickMenu />, { livekitRoom: fakeLivekitRoom('d1') });

    await user.click(screen.getByRole('button', { name: 'Configurações do microfone' }));
    await user.click(await screen.findByText('Configurações completas'));

    expect(navigate).toHaveBeenCalledWith('/app/settings/av');
  });
});

describe('CameraQuickMenu', () => {
  it('espelhar a previa: mostra o estado atual e aciona o setter, sem tocar no dispositivo', async () => {
    const user = userEvent.setup();
    vi.spyOn(Room, 'getLocalDevices').mockResolvedValue([{ deviceId: 'c1', label: 'Webcam', kind: 'videoinput' } as MediaDeviceInfo]);
    const setMirrorCameraPreview = vi.fn();
    renderWithRoom(<CameraQuickMenu />, { livekitRoom: fakeLivekitRoom('c1'), mirrorCameraPreview: true, setMirrorCameraPreview });

    await user.click(screen.getByRole('button', { name: 'Configurações da câmera' }));
    const toggle = await screen.findByText('Espelhar minha prévia');
    await user.click(toggle);

    expect(setMirrorCameraPreview).toHaveBeenCalledWith(false, expect.anything());
  });

  it('sem permissao ainda concedida, oferece pedir acesso em vez de uma lista vazia', async () => {
    const user = userEvent.setup();
    vi.spyOn(Room, 'getLocalDevices').mockResolvedValue([{ deviceId: 'c1', label: '', kind: 'videoinput' } as MediaDeviceInfo]);
    renderWithRoom(<CameraQuickMenu />, { livekitRoom: fakeLivekitRoom(undefined) });

    await user.click(screen.getByRole('button', { name: 'Configurações da câmera' }));
    expect(await screen.findByText('Permitir acesso aos dispositivos')).toBeInTheDocument();
  });
});

describe('SpeakerQuickMenu', () => {
  it('lista as saidas de audio disponiveis', async () => {
    const user = userEvent.setup();
    vi.spyOn(Room, 'getLocalDevices').mockResolvedValue([
      { deviceId: 's1', label: 'Alto-falantes', kind: 'audiooutput' } as MediaDeviceInfo,
    ]);
    renderWithRoom(<SpeakerQuickMenu />, { livekitRoom: fakeLivekitRoom('s1') });

    await user.click(screen.getByRole('button', { name: 'Configurações de saída de áudio' }));
    expect(await screen.findByText('Alto-falantes')).toBeInTheDocument();
  });
});

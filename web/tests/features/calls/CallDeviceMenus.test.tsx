import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Room } from 'livekit-client';
import type { Room as LKRoom } from 'livekit-client';
import { Track } from 'livekit-client';
import { renderWithRoom } from '@tests/fixtures/roomContextFixture';
import { initialRoomState } from '@/state/roomReducer';
import { CameraQuickMenu, MicQuickMenu, ScreenShareQuickMenu, SpeakerQuickMenu } from '@/features/calls/CallDeviceMenus';

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

function fakeLivekitRoomForShare(screenPub?: { isMuted: boolean; track: object }) {
  const room = {
    localParticipant: { identity: 'p-1', getTrackPublication: (source: Track.Source) => (source === Track.Source.ScreenShare ? screenPub : undefined) },
    getParticipantByIdentity: vi.fn(() => undefined),
    on: vi.fn(),
    off: vi.fn(),
  };
  return room as unknown as LKRoom;
}

describe('ScreenShareQuickMenu', () => {
  it('lista as 3 opcoes de qualidade e troca a preferencia ao escolher outra', async () => {
    const user = userEvent.setup();
    const setShareQuality = vi.fn();
    renderWithRoom(<ScreenShareQuickMenu />, {
      state: { ...initialRoomState, me: { ...initialRoomState.me, id: 'p-1' } },
      livekitRoom: fakeLivekitRoomForShare(),
      shareQuality: 'standard',
      setShareQuality,
    });

    await user.click(screen.getByRole('button', { name: 'Configurações de compartilhamento de tela' }));
    await user.click(await screen.findByText('Fluida, para vídeo ou jogos (720p, 30 fps)'));

    expect(setShareQuality).toHaveBeenCalledWith('smooth');
  });

  it('sem compartilhamento ativo, nao mostra trocar fonte nem pausar previa', async () => {
    const user = userEvent.setup();
    renderWithRoom(<ScreenShareQuickMenu />, {
      state: { ...initialRoomState, me: { ...initialRoomState.me, id: 'p-1', sharing: false } },
      livekitRoom: fakeLivekitRoomForShare(),
    });

    await user.click(screen.getByRole('button', { name: 'Configurações de compartilhamento de tela' }));
    expect(screen.queryByText('Trocar fonte')).not.toBeInTheDocument();
    expect(screen.queryByText('Pausar prévia')).not.toBeInTheDocument();
  });

  it('compartilhando, oferece trocar fonte e pausar previa; clicar aciona cada acao', async () => {
    const user = userEvent.setup();
    const changeSource = vi.fn(async () => undefined);
    const pauseSharePreview = vi.fn(async () => undefined);
    renderWithRoom(<ScreenShareQuickMenu />, {
      state: { ...initialRoomState, me: { ...initialRoomState.me, id: 'p-1', sharing: true } },
      livekitRoom: fakeLivekitRoomForShare({ isMuted: false, track: {} }),
      changeSource,
      pauseSharePreview,
    });

    await user.click(screen.getByRole('button', { name: 'Configurações de compartilhamento de tela' }));
    await user.click(await screen.findByText('Trocar fonte'));
    expect(changeSource).toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Configurações de compartilhamento de tela' }));
    await user.click(await screen.findByText('Pausar prévia'));
    expect(pauseSharePreview).toHaveBeenCalled();
  });

  it('compartilhamento pausado: mostra "Retomar prévia" e chama resumeSharePreview', async () => {
    const user = userEvent.setup();
    const resumeSharePreview = vi.fn(async () => undefined);
    renderWithRoom(<ScreenShareQuickMenu />, {
      state: { ...initialRoomState, me: { ...initialRoomState.me, id: 'p-1', sharing: true } },
      livekitRoom: fakeLivekitRoomForShare({ isMuted: true, track: {} }),
      resumeSharePreview,
    });

    await user.click(screen.getByRole('button', { name: 'Configurações de compartilhamento de tela' }));
    await user.click(await screen.findByText('Retomar prévia'));
    expect(resumeSharePreview).toHaveBeenCalled();
  });
});

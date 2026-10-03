import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Room, Track } from 'livekit-client';
import { initialRoomState } from '@/state/roomReducer';
import { renderWithRoom } from '@tests/fixtures/roomContextFixture';
import { CallControlBar } from '@/features/calls/CallControlBar';

describe('CallControlBar', () => {
  it('renders reactions and the call controls (mic/listen/camera/screen) and leave', () => {
    renderWithRoom(<CallControlBar />);
    expect(screen.getByLabelText('Reagir')).toBeInTheDocument();
    // no mic publication yet (initial state), so the button offers to activate it.
    expect(screen.getByLabelText('Ativar microfone')).toBeInTheDocument();
    expect(screen.getByLabelText('Parar de ouvir')).toBeInTheDocument();
    expect(screen.getByLabelText('Ligar câmera')).toBeInTheDocument();
    expect(screen.getByLabelText('Compartilhar tela')).toBeInTheDocument();
    expect(screen.getByLabelText('Sair da chamada')).toBeInTheDocument();
  });

  it('triggers toggleMicMuted when clicking the mic control', () => {
    const toggleMicMuted = vi.fn();
    const livekitRoom = new Room();
    vi.spyOn(livekitRoom.localParticipant, 'getTrackPublication').mockImplementation((source) => (
      source === Track.Source.Microphone ? { isMuted: true, track: undefined } as never : undefined
    ));
    renderWithRoom(<CallControlBar />, { toggleMicMuted, livekitRoom });
    fireEvent.click(screen.getByLabelText('Desmutar'));
    expect(toggleMicMuted).toHaveBeenCalledTimes(1);
  });

  it('with no mic published, the button tries to activate the mic instead of muting', () => {
    const activateMic = vi.fn();
    const toggleMicMuted = vi.fn();
    renderWithRoom(<CallControlBar />, { activateMic, toggleMicMuted });
    fireEvent.click(screen.getByLabelText('Ativar microfone'));
    expect(activateMic).toHaveBeenCalledTimes(1);
    expect(toggleMicMuted).not.toHaveBeenCalled();
  });

  it('with no mic connected, warns on the button and with a notice that only disappears when dismissed', () => {
    renderWithRoom(<CallControlBar />, { state: { ...initialRoomState, micProblem: 'not-found' } });
    expect(screen.getByLabelText('Nenhum microfone encontrado')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('conecte um microfone');
    fireEvent.click(screen.getByLabelText('Dispensar aviso'));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    // the button keeps saying it even after the notice is dismissed
    expect(screen.getByLabelText('Nenhum microfone encontrado')).toBeInTheDocument();
  });

  it('with the mic blocked by the browser, explains how to unblock it', () => {
    renderWithRoom(<CallControlBar />, { state: { ...initialRoomState, micProblem: 'denied' } });
    expect(screen.getByLabelText('Microfone bloqueado pelo navegador')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('permissões do site');
  });

  it('triggers leaveCall when clicking leave call', () => {
    const leaveCall = vi.fn();
    renderWithRoom(<CallControlBar />, { leaveCall });
    fireEvent.click(screen.getByLabelText('Sair da chamada'));
    expect(leaveCall).toHaveBeenCalledTimes(1);
  });

  it('shows the share error notice when present', () => {
    renderWithRoom(<CallControlBar />, {
      state: { ...initialRoomState, shareError: 'Nao foi possivel acessar a camera.' },
    });
    expect(screen.getByText('Nao foi possivel acessar a camera.')).toBeInTheDocument();
  });

  it('mic that fails to start: suggests it may be in use by another application', () => {
    renderWithRoom(<CallControlBar />, { state: { ...initialRoomState, micProblem: 'unavailable' } });
    expect(screen.getByLabelText('Microfone indisponível')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('em uso por outro aplicativo');
  });

  it('active camera and screen share use the same visual treatment (green)', () => {
    renderWithRoom(<CallControlBar />, {
      state: { ...initialRoomState, me: { ...initialRoomState.me, cameraOn: true, sharing: true } },
    });
    expect(screen.getByLabelText('Parar câmera').className).toMatch(/bg-green/);
    expect(screen.getByLabelText('Parar compartilhamento').className).toMatch(/bg-green/);
  });

  it('camera and screen share turned off do not use the active color', () => {
    renderWithRoom(<CallControlBar />);
    expect(screen.getByLabelText('Ligar câmera').className).not.toMatch(/bg-green/);
    expect(screen.getByLabelText('Compartilhar tela').className).not.toMatch(/bg-green/);
  });

  it('muted and deafened mic use the red treatment', () => {
    const livekitRoom = new Room();
    vi.spyOn(livekitRoom.localParticipant, 'getTrackPublication').mockImplementation((source) => (
      source === Track.Source.Microphone ? { isMuted: true, track: undefined } as never : undefined
    ));
    renderWithRoom(<CallControlBar />, { livekitRoom, deafened: true });
    expect(screen.getByLabelText('Desmutar').className).toMatch(/bg-red/);
    expect(screen.getByLabelText('Voltar a ouvir').className).toMatch(/bg-red/);
  });

  it('leave call keeps its own red highlight, outside the neutral grouping', () => {
    renderWithRoom(<CallControlBar />);
    expect(screen.getByLabelText('Sair da chamada').className).toMatch(/bg-red\b/);
  });

  it('shows the fullscreen button and triggers toggleCallFullscreen when clicked', () => {
    const toggleCallFullscreen = vi.fn();
    renderWithRoom(<CallControlBar />, { toggleCallFullscreen });
    fireEvent.click(screen.getByLabelText('Tela cheia'));
    expect(toggleCallFullscreen).toHaveBeenCalledTimes(1);
  });

  it('when already in fullscreen, the button offers to exit', () => {
    renderWithRoom(<CallControlBar />, { isCallFullscreen: true });
    expect(screen.getByLabelText('Sair da tela cheia')).toBeInTheDocument();
    expect(screen.queryByLabelText('Tela cheia')).not.toBeInTheDocument();
  });

  it('without hudVisible (defaults to true), the bar stays visible', () => {
    renderWithRoom(<CallControlBar />);
    const bar = screen.getByLabelText('Sair da chamada').closest('div.absolute');
    expect(bar).toHaveClass('opacity-100');
  });

  it('with hudVisible=false, the bar has zero opacity but stays in the DOM', () => {
    renderWithRoom(<CallControlBar hudVisible={false} />);
    const bar = screen.getByLabelText('Sair da chamada').closest('div.absolute');
    expect(bar).toHaveClass('opacity-0', 'pointer-events-none');
  });
});

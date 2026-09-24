import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Room, Track } from 'livekit-client';
import { initialRoomState } from '@/state/roomReducer';
import { renderWithRoom } from '@tests/fixtures/roomContextFixture';
import { CallControlBar } from '@/features/calls/CallControlBar';

describe('CallControlBar', () => {
  it('renderiza reacoes e os controles da chamada (mic/ouvir/camera/tela) e sair', () => {
    renderWithRoom(<CallControlBar />);
    expect(screen.getByLabelText('Reagir')).toBeInTheDocument();
    // no mic publication yet (initial state), so the button offers to activate it.
    expect(screen.getByLabelText('Ativar microfone')).toBeInTheDocument();
    expect(screen.getByLabelText('Parar de ouvir')).toBeInTheDocument();
    expect(screen.getByLabelText('Ligar câmera')).toBeInTheDocument();
    expect(screen.getByLabelText('Compartilhar tela')).toBeInTheDocument();
    expect(screen.getByLabelText('Sair da chamada')).toBeInTheDocument();
  });

  it('aciona toggleMicMuted ao clicar no controle de microfone', () => {
    const toggleMicMuted = vi.fn();
    const livekitRoom = new Room();
    vi.spyOn(livekitRoom.localParticipant, 'getTrackPublication').mockImplementation((source) => (
      source === Track.Source.Microphone ? { isMuted: true, track: undefined } as never : undefined
    ));
    renderWithRoom(<CallControlBar />, { toggleMicMuted, livekitRoom });
    fireEvent.click(screen.getByLabelText('Desmutar'));
    expect(toggleMicMuted).toHaveBeenCalledTimes(1);
  });

  it('sem microfone publicado, o botao tenta ativar o microfone em vez de mutar', () => {
    const activateMic = vi.fn();
    const toggleMicMuted = vi.fn();
    renderWithRoom(<CallControlBar />, { activateMic, toggleMicMuted });
    fireEvent.click(screen.getByLabelText('Ativar microfone'));
    expect(activateMic).toHaveBeenCalledTimes(1);
    expect(toggleMicMuted).not.toHaveBeenCalled();
  });

  it('sem microfone conectado, avisa no botao e com um aviso que so some ao dispensar', () => {
    renderWithRoom(<CallControlBar />, { state: { ...initialRoomState, micProblem: 'not-found' } });
    expect(screen.getByLabelText('Nenhum microfone encontrado')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('conecte um microfone');
    fireEvent.click(screen.getByLabelText('Dispensar aviso'));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    // the button keeps saying it even after the notice is dismissed
    expect(screen.getByLabelText('Nenhum microfone encontrado')).toBeInTheDocument();
  });

  it('com o microfone bloqueado pelo navegador, explica como liberar', () => {
    renderWithRoom(<CallControlBar />, { state: { ...initialRoomState, micProblem: 'denied' } });
    expect(screen.getByLabelText('Microfone bloqueado pelo navegador')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('permissões do site');
  });

  it('aciona leaveCall ao clicar em sair da chamada', () => {
    const leaveCall = vi.fn();
    renderWithRoom(<CallControlBar />, { leaveCall });
    fireEvent.click(screen.getByLabelText('Sair da chamada'));
    expect(leaveCall).toHaveBeenCalledTimes(1);
  });

  it('mostra o aviso de erro de compartilhamento quando presente', () => {
    renderWithRoom(<CallControlBar />, {
      state: { ...initialRoomState, shareError: 'Nao foi possivel acessar a camera.' },
    });
    expect(screen.getByText('Nao foi possivel acessar a camera.')).toBeInTheDocument();
  });

  it('microfone que nao inicia: sugere que pode estar em uso por outro aplicativo', () => {
    renderWithRoom(<CallControlBar />, { state: { ...initialRoomState, micProblem: 'unavailable' } });
    expect(screen.getByLabelText('Microfone indisponível')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('em uso por outro aplicativo');
  });
});

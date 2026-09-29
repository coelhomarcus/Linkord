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

  it('camera e compartilhamento ativos usam o mesmo tratamento visual (verde)', () => {
    renderWithRoom(<CallControlBar />, {
      state: { ...initialRoomState, me: { ...initialRoomState.me, cameraOn: true, sharing: true } },
    });
    expect(screen.getByLabelText('Parar câmera').className).toMatch(/bg-green/);
    expect(screen.getByLabelText('Parar compartilhamento').className).toMatch(/bg-green/);
  });

  it('camera e compartilhamento desligados nao usam a cor de ativo', () => {
    renderWithRoom(<CallControlBar />);
    expect(screen.getByLabelText('Ligar câmera').className).not.toMatch(/bg-green/);
    expect(screen.getByLabelText('Compartilhar tela').className).not.toMatch(/bg-green/);
  });

  it('microfone mutado e ensurdecido usam o tratamento vermelho', () => {
    const livekitRoom = new Room();
    vi.spyOn(livekitRoom.localParticipant, 'getTrackPublication').mockImplementation((source) => (
      source === Track.Source.Microphone ? { isMuted: true, track: undefined } as never : undefined
    ));
    renderWithRoom(<CallControlBar />, { livekitRoom, deafened: true });
    expect(screen.getByLabelText('Desmutar').className).toMatch(/bg-red/);
    expect(screen.getByLabelText('Voltar a ouvir').className).toMatch(/bg-red/);
  });

  it('sair da chamada continua com destaque vermelho proprio, fora do agrupamento neutro', () => {
    renderWithRoom(<CallControlBar />);
    expect(screen.getByLabelText('Sair da chamada').className).toMatch(/bg-red\b/);
  });

  it('mostra o botao de tela cheia e aciona toggleCallFullscreen ao clicar', () => {
    const toggleCallFullscreen = vi.fn();
    renderWithRoom(<CallControlBar />, { toggleCallFullscreen });
    fireEvent.click(screen.getByLabelText('Tela cheia'));
    expect(toggleCallFullscreen).toHaveBeenCalledTimes(1);
  });

  it('quando ja esta em tela cheia, o botao oferece sair', () => {
    renderWithRoom(<CallControlBar />, { isCallFullscreen: true });
    expect(screen.getByLabelText('Sair da tela cheia')).toBeInTheDocument();
    expect(screen.queryByLabelText('Tela cheia')).not.toBeInTheDocument();
  });

  it('sem hudVisible (padrao true), a barra fica visivel', () => {
    renderWithRoom(<CallControlBar />);
    const bar = screen.getByLabelText('Sair da chamada').closest('div.absolute');
    expect(bar).toHaveClass('opacity-100');
  });

  it('com hudVisible=false, a barra fica com opacidade zero mas continua no DOM', () => {
    renderWithRoom(<CallControlBar hudVisible={false} />);
    const bar = screen.getByLabelText('Sair da chamada').closest('div.absolute');
    expect(bar).toHaveClass('opacity-0', 'pointer-events-none');
  });
});

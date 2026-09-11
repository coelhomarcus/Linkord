import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { initialRoomState } from '../../state/roomReducer';
import { renderWithRoom } from '../../test/roomContextFixture';
import { CallControlBar } from './CallControlBar';

describe('CallControlBar', () => {
  it('renderiza reacoes e os controles da chamada (mic/ouvir/camera/tela) e sair', () => {
    renderWithRoom(<CallControlBar />);
    expect(screen.getByLabelText('Reagir')).toBeInTheDocument();
    // sem publicacao de mic ainda (estado inicial), entao o botao mostra "Desmutar".
    expect(screen.getByLabelText('Desmutar')).toBeInTheDocument();
    expect(screen.getByLabelText('Parar de ouvir')).toBeInTheDocument();
    expect(screen.getByLabelText('Ligar câmera')).toBeInTheDocument();
    expect(screen.getByLabelText('Compartilhar tela')).toBeInTheDocument();
    expect(screen.getByLabelText('Sair da chamada')).toBeInTheDocument();
  });

  it('aciona toggleMicMuted ao clicar no controle de microfone', () => {
    const toggleMicMuted = vi.fn();
    renderWithRoom(<CallControlBar />, { toggleMicMuted });
    fireEvent.click(screen.getByLabelText('Desmutar'));
    expect(toggleMicMuted).toHaveBeenCalledTimes(1);
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
});

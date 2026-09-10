import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { initialRoomState } from '../../state/roomReducer';
import { renderWithRoom } from '../../test/roomContextFixture';
import { CallControlBar } from './CallControlBar';

describe('CallControlBar', () => {
  it('renderiza reacoes, os controles da chamada (mic/ouvir/camera/tela) e sair', () => {
    renderWithRoom(<CallControlBar />);
    expect(screen.getByLabelText('Reagir')).toBeInTheDocument();
    // sem publicacao de mic ainda (estado inicial), entao o botao mostra "Desmutar".
    expect(screen.getByTitle('Desmutar')).toBeInTheDocument();
    expect(screen.getByTitle('Parar de ouvir')).toBeInTheDocument();
    expect(screen.getByTitle('Ligar camera')).toBeInTheDocument();
    expect(screen.getByTitle('Compartilhar tela')).toBeInTheDocument();
    expect(screen.getByLabelText('Sair da chamada')).toBeInTheDocument();
  });

  it('aciona toggleMicMuted ao clicar no controle de microfone', () => {
    const toggleMicMuted = vi.fn();
    renderWithRoom(<CallControlBar />, { toggleMicMuted });
    fireEvent.click(screen.getByTitle('Desmutar'));
    expect(toggleMicMuted).toHaveBeenCalledTimes(1);
  });

  it('aciona leaveGroupCall ao clicar em sair da chamada', () => {
    const leaveGroupCall = vi.fn();
    renderWithRoom(<CallControlBar />, { leaveGroupCall });
    fireEvent.click(screen.getByLabelText('Sair da chamada'));
    expect(leaveGroupCall).toHaveBeenCalledTimes(1);
  });

  it('mostra o aviso de erro de compartilhamento quando presente', () => {
    renderWithRoom(<CallControlBar />, {
      state: { ...initialRoomState, shareError: 'Nao foi possivel acessar a camera.' },
    });
    expect(screen.getByText('Nao foi possivel acessar a camera.')).toBeInTheDocument();
  });
});

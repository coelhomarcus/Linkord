import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CallChatToggleButton } from '@/features/calls/CallChatToggleButton';

describe('CallChatToggleButton', () => {
  it('mostra "Abrir chat" quando fechado e aciona onToggleChat ao clicar', () => {
    const onToggleChat = vi.fn();
    render(<CallChatToggleButton chatOpen={false} onToggleChat={onToggleChat} />);
    fireEvent.click(screen.getByLabelText('Abrir chat'));
    expect(onToggleChat).toHaveBeenCalledTimes(1);
  });

  it('mostra "Fechar chat" quando aberto', () => {
    render(<CallChatToggleButton chatOpen onToggleChat={vi.fn()} />);
    expect(screen.getByLabelText('Fechar chat')).toBeInTheDocument();
  });

  it('por padrao (sem hudVisible), fica visivel', () => {
    render(<CallChatToggleButton chatOpen={false} onToggleChat={vi.fn()} />);
    const wrapper = screen.getByLabelText('Abrir chat').closest('div');
    expect(wrapper).toHaveClass('opacity-100');
  });

  it('com hudVisible=false, fica com opacidade zero e sem interceptar cliques — mas continua no DOM (nao afeta layout)', () => {
    render(<CallChatToggleButton chatOpen={false} onToggleChat={vi.fn()} hudVisible={false} />);
    const button = screen.getByLabelText('Abrir chat');
    expect(button).toBeInTheDocument();
    const wrapper = button.closest('div');
    expect(wrapper).toHaveClass('opacity-0', 'pointer-events-none');
  });
});

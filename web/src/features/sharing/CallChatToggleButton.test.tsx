import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CallChatToggleButton } from './CallChatToggleButton';

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
});

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CallChatToggleButton } from '@/features/calls/CallChatToggleButton';

describe('CallChatToggleButton', () => {
  it('shows "Abrir chat" when closed and triggers onToggleChat on click', () => {
    const onToggleChat = vi.fn();
    render(<CallChatToggleButton chatOpen={false} onToggleChat={onToggleChat} />);
    fireEvent.click(screen.getByLabelText('Abrir chat'));
    expect(onToggleChat).toHaveBeenCalledTimes(1);
  });

  it('shows "Fechar chat" when open', () => {
    render(<CallChatToggleButton chatOpen onToggleChat={vi.fn()} />);
    expect(screen.getByLabelText('Fechar chat')).toBeInTheDocument();
  });

  it('by default (without hudVisible), stays visible', () => {
    render(<CallChatToggleButton chatOpen={false} onToggleChat={vi.fn()} />);
    const wrapper = screen.getByLabelText('Abrir chat').closest('div');
    expect(wrapper).toHaveClass('opacity-100');
  });

  it('with hudVisible=false, has zero opacity and does not intercept clicks — but stays in the DOM (does not affect layout)', () => {
    render(<CallChatToggleButton chatOpen={false} onToggleChat={vi.fn()} hudVisible={false} />);
    const button = screen.getByLabelText('Abrir chat');
    expect(button).toBeInTheDocument();
    const wrapper = button.closest('div');
    expect(wrapper).toHaveClass('opacity-0', 'pointer-events-none');
  });
});

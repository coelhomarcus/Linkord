import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReactionEmojiPicker } from '@/features/chat/ReactionEmojiPicker';

describe('ReactionEmojiPicker', () => {
  it('never opened: shows only the quick row, does not mount the full picker', () => {
    render(<ReactionEmojiPicker fullPickerOpen={false} warmed={false} onPick={vi.fn()} onMore={vi.fn()} />);
    expect(screen.getByLabelText('Mais emojis')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Buscar emoji…')).not.toBeInTheDocument();
  });

  it('full picker open: shows the picker, hides the quick row', () => {
    render(<ReactionEmojiPicker fullPickerOpen warmed onPick={vi.fn()} onMore={vi.fn()} />);
    expect(screen.getByPlaceholderText('Buscar emoji…')).toBeVisible();
    expect(screen.queryByLabelText('Mais emojis')).not.toBeInTheDocument();
  });

  it('warmed but back to the quick row: picker stays in the DOM, just hidden (does not remount on the next "more")', () => {
    const { container } = render(<ReactionEmojiPicker fullPickerOpen={false} warmed onPick={vi.fn()} onMore={vi.fn()} />);
    expect(screen.getByLabelText('Mais emojis')).toBeInTheDocument();
    const hiddenPicker = container.querySelector('[hidden]');
    expect(hiddenPicker).not.toBeNull();
    expect(hiddenPicker?.querySelector('input[placeholder="Buscar emoji…"]')).not.toBeNull();
  });
});

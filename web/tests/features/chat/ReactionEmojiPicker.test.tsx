import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReactionEmojiPicker } from '@/features/chat/ReactionEmojiPicker';

describe('ReactionEmojiPicker', () => {
  it('nunca aberto: mostra so a linha rapida, nao monta o picker completo', () => {
    render(<ReactionEmojiPicker fullPickerOpen={false} warmed={false} onPick={vi.fn()} onMore={vi.fn()} />);
    expect(screen.getByLabelText('Mais emojis')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Buscar emoji…')).not.toBeInTheDocument();
  });

  it('picker completo aberto: mostra o picker, esconde a linha rapida', () => {
    render(<ReactionEmojiPicker fullPickerOpen warmed onPick={vi.fn()} onMore={vi.fn()} />);
    expect(screen.getByPlaceholderText('Buscar emoji…')).toBeVisible();
    expect(screen.queryByLabelText('Mais emojis')).not.toBeInTheDocument();
  });

  it('esquentado mas voltou pra linha rapida: picker fica no DOM, so escondido (nao remonta no proximo "mais")', () => {
    const { container } = render(<ReactionEmojiPicker fullPickerOpen={false} warmed onPick={vi.fn()} onMore={vi.fn()} />);
    expect(screen.getByLabelText('Mais emojis')).toBeInTheDocument();
    const hiddenPicker = container.querySelector('[hidden]');
    expect(hiddenPicker).not.toBeNull();
    expect(hiddenPicker?.querySelector('input[placeholder="Buscar emoji…"]')).not.toBeNull();
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { EmojiPicker } from './emoji-picker';

let lastPickerProps: Record<string, unknown> | null = null;

vi.mock('emoji-mart', () => ({
  Picker: class FakePicker {
    element: HTMLElement;
    constructor(props: Record<string, unknown>) {
      lastPickerProps = props;
      this.element = document.createElement('div');
      this.element.setAttribute('data-testid', 'fake-em-emoji-picker');
      return this.element as unknown as FakePicker;
    }
  },
}));

vi.mock('@emoji-mart/data', () => ({ default: { categories: [], emojis: {} } }));

describe('EmojiPicker', () => {
  afterEach(() => {
    lastPickerProps = null;
    vi.restoreAllMocks();
  });

  it('monta o picker (mockado) dentro do container e repassa a selecao de emoji normalizada', async () => {
    const onEmojiSelect = vi.fn();
    const { container } = render(<EmojiPicker onEmojiSelect={onEmojiSelect} />);

    await waitFor(() => expect(container.querySelector('[data-testid="fake-em-emoji-picker"]')).toBeInTheDocument());

    expect(lastPickerProps).toBeTruthy();
    const onPickerEmojiSelect = lastPickerProps!.onEmojiSelect as (emoji: { native: string }) => void;
    onPickerEmojiSelect({ native: '🎉' });
    expect(onEmojiSelect).toHaveBeenCalledWith({ emoji: '🎉' });
  });

  it('remove o picker do container ao desmontar', async () => {
    const { container, unmount } = render(<EmojiPicker onEmojiSelect={vi.fn()} />);
    await waitFor(() => expect(container.querySelector('[data-testid="fake-em-emoji-picker"]')).toBeInTheDocument());

    unmount();

    expect(container.querySelector('[data-testid="fake-em-emoji-picker"]')).not.toBeInTheDocument();
  });
});

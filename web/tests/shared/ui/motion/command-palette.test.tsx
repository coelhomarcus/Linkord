import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CommandPalette } from '@/shared/ui/motion/command-palette';
import type { CommandItem } from '@/shared/ui/motion/command-palette';

function buildItems(onLeafSelect: () => void): CommandItem[] {
  return [
    {
      id: 'action:call',
      label: 'Ligar para…',
      stage: {
        items: [{ id: 'person:ana', label: 'Ana', onSelect: onLeafSelect }],
        placeholder: 'Ligar pra quem?',
      },
    },
    { id: 'conversation:x', label: 'Conversa X', onSelect: vi.fn() },
  ];
}

describe('CommandPalette — stages (CommandItem.stage)', () => {
  it('selecting an item with a stage opens the sub-list without closing or calling onSelect', async () => {
    const user = userEvent.setup();
    const onLeafSelect = vi.fn();
    const onOpenChange = vi.fn();
    render(<CommandPalette items={buildItems(onLeafSelect)} open onOpenChange={onOpenChange} />);

    await user.click(await screen.findByText('Ligar para…'));

    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(onLeafSelect).not.toHaveBeenCalled();
    expect(await screen.findByText('Ana')).toBeInTheDocument();
    expect(screen.queryByText('Conversa X')).not.toBeInTheDocument();
  });

  it('Backspace with an empty search goes back to the root', async () => {
    const user = userEvent.setup();
    render(<CommandPalette items={buildItems(vi.fn())} open onOpenChange={vi.fn()} />);
    await user.click(await screen.findByText('Ligar para…'));
    expect(await screen.findByText('Ana')).toBeInTheDocument();

    await user.keyboard('{Backspace}');

    expect(await screen.findByText('Ligar para…')).toBeInTheDocument();
    expect(screen.queryByText('Ana')).not.toBeInTheDocument();
  });

  it('Escape inside a stage goes back to the root instead of closing the palette', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<CommandPalette items={buildItems(vi.fn())} open onOpenChange={onOpenChange} />);
    await user.click(await screen.findByText('Ligar para…'));

    await user.keyboard('{Escape}');

    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(await screen.findByText('Ligar para…')).toBeInTheDocument();
  });

  it('selecting a leaf item inside a stage calls onSelect and closes the palette', async () => {
    const user = userEvent.setup();
    const onLeafSelect = vi.fn();
    const onOpenChange = vi.fn();
    render(<CommandPalette items={buildItems(onLeafSelect)} open onOpenChange={onOpenChange} />);
    await user.click(await screen.findByText('Ligar para…'));
    await user.click(await screen.findByText('Ana'));

    expect(onLeafSelect).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('reopening the palette always goes back to the root, even coming from inside a stage', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<CommandPalette items={buildItems(vi.fn())} open onOpenChange={vi.fn()} />);
    await user.click(await screen.findByText('Ligar para…'));
    expect(await screen.findByText('Ana')).toBeInTheDocument();

    rerender(<CommandPalette items={buildItems(vi.fn())} open={false} onOpenChange={vi.fn()} />);
    rerender(<CommandPalette items={buildItems(vi.fn())} open onOpenChange={vi.fn()} />);

    expect(await screen.findByText('Ligar para…')).toBeInTheDocument();
    expect(screen.queryByText('Ana')).not.toBeInTheDocument();
  });
});

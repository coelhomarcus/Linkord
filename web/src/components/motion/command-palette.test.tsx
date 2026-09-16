import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CommandPalette } from './command-palette';
import type { CommandItem } from './command-palette';

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

describe('CommandPalette — etapas (CommandItem.stage)', () => {
  it('selecionar um item com stage abre a sub-lista sem fechar nem chamar onSelect', async () => {
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

  it('Backspace com a busca vazia volta pra raiz', async () => {
    const user = userEvent.setup();
    render(<CommandPalette items={buildItems(vi.fn())} open onOpenChange={vi.fn()} />);
    await user.click(await screen.findByText('Ligar para…'));
    expect(await screen.findByText('Ana')).toBeInTheDocument();

    await user.keyboard('{Backspace}');

    expect(await screen.findByText('Ligar para…')).toBeInTheDocument();
    expect(screen.queryByText('Ana')).not.toBeInTheDocument();
  });

  it('Escape dentro de uma etapa volta pra raiz em vez de fechar o palette', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<CommandPalette items={buildItems(vi.fn())} open onOpenChange={onOpenChange} />);
    await user.click(await screen.findByText('Ligar para…'));

    await user.keyboard('{Escape}');

    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(await screen.findByText('Ligar para…')).toBeInTheDocument();
  });

  it('selecionar um item terminal dentro de uma etapa chama onSelect e fecha o palette', async () => {
    const user = userEvent.setup();
    const onLeafSelect = vi.fn();
    const onOpenChange = vi.fn();
    render(<CommandPalette items={buildItems(onLeafSelect)} open onOpenChange={onOpenChange} />);
    await user.click(await screen.findByText('Ligar para…'));
    await user.click(await screen.findByText('Ana'));

    expect(onLeafSelect).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('reabrir o palette sempre volta pra raiz, mesmo saindo de dentro de uma etapa', async () => {
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

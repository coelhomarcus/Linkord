import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CloseButton } from '@/shared/ui/primitives/close-button';

describe('CloseButton', () => {
  it('chama onClick e se chama "Fechar" por padrao', async () => {
    const onClick = vi.fn();
    render(<CloseButton onClick={onClick} />);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Fechar' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('aceita outro nome acessivel', () => {
    render(<CloseButton label="Dispensar aviso" />);
    expect(screen.getByRole('button', { name: 'Dispensar aviso' })).toBeInTheDocument();
  });

  it('a variante overlay ganha fundo escuro para nao sumir sobre uma imagem', () => {
    render(<CloseButton variant="overlay" />);
    expect(screen.getByRole('button', { name: 'Fechar' }).className).toContain('bg-black/60');
    expect(screen.getByRole('button', { name: 'Fechar' }).className).toContain('text-white');
  });
});

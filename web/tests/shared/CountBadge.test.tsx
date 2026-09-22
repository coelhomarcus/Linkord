import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CountBadge } from '@/shared/CountBadge';

describe('CountBadge', () => {
  it('altura fixa e min-width, do mesmo tamanho — nunca vira oval', () => {
    render(<CountBadge>3</CountBadge>);
    const badge = screen.getByText('3');
    expect(badge.className).toContain('h-4.5');
    expect(badge.className).toContain('min-w-4.5');
    expect(badge.className).toContain('rounded-full');
  });

  it('sem label nem decorative: texto visivel, sem aria-hidden nem aria-label proprios', () => {
    render(<CountBadge>7</CountBadge>);
    const badge = screen.getByText('7');
    expect(badge).not.toHaveAttribute('aria-hidden');
    expect(badge).not.toHaveAttribute('aria-label');
  });

  it('decorative: aria-hidden, pro pai (com o proprio aria-label) ser a unica fonte do nome', () => {
    render(<CountBadge decorative>4</CountBadge>);
    expect(screen.getByText('4')).toHaveAttribute('aria-hidden', 'true');
  });

  it('label: vira o proprio nome acessivel do badge', () => {
    render(<CountBadge label="2 convites aguardando resposta">2</CountBadge>);
    expect(screen.getByLabelText('2 convites aguardando resposta')).toBeInTheDocument();
  });

  it('className extra se combina (tamanho maior de um contexto especifico)', () => {
    render(<CountBadge className="h-5 min-w-5 px-1.5 text-[11px]">12</CountBadge>);
    const badge = screen.getByText('12');
    expect(badge.className).toContain('h-5');
    expect(badge.className).toContain('min-w-5');
  });
});

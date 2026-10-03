import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CountBadge } from '@/shared/CountBadge';

describe('CountBadge', () => {
  it('fixed height and min-width, same size — never becomes an oval', () => {
    render(<CountBadge>3</CountBadge>);
    const badge = screen.getByText('3');
    expect(badge.className).toContain('h-4.5');
    expect(badge.className).toContain('min-w-4.5');
    expect(badge.className).toContain('rounded-full');
  });

  it('without label or decorative: visible text, no aria-hidden or aria-label of its own', () => {
    render(<CountBadge>7</CountBadge>);
    const badge = screen.getByText('7');
    expect(badge).not.toHaveAttribute('aria-hidden');
    expect(badge).not.toHaveAttribute('aria-label');
  });

  it('decorative: aria-hidden, so the parent (with its own aria-label) is the sole name source', () => {
    render(<CountBadge decorative>4</CountBadge>);
    expect(screen.getByText('4')).toHaveAttribute('aria-hidden', 'true');
  });

  it('label: becomes the badge\'s own accessible name', () => {
    render(<CountBadge label="2 convites aguardando resposta">2</CountBadge>);
    expect(screen.getByLabelText('2 convites aguardando resposta')).toBeInTheDocument();
  });

  it('extra className merges in (larger size for a specific context)', () => {
    render(<CountBadge className="h-5 min-w-5 px-1.5 text-[11px]">12</CountBadge>);
    const badge = screen.getByText('12');
    expect(badge.className).toContain('h-5');
    expect(badge.className).toContain('min-w-5');
  });
});

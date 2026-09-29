import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OTPInput } from '@/shared/ui/motion/otp-input';

describe('OTPInput', () => {
  it('fills all six slots and fires onComplete once', async () => {
    const user = userEvent.setup();
    let completed = '';
    render(<OTPInput onComplete={(value) => { completed = value; }} aria-label="Código" />);

    await user.click(screen.getByLabelText('Código'));
    await user.keyboard('123456');

    expect(completed).toBe('123456');
    expect(screen.getAllByText(/[1-6]/)).toHaveLength(6);
  });

  it('accepts pasting a code and exposes the error state', () => {
    render(<OTPInput status="error" errorMessage="Código inválido." aria-label="Código" />);
    const input = screen.getByLabelText('Código');
    fireEvent.paste(input, { clipboardData: { getData: () => '654321' } });

    expect(screen.getByText('Código inválido.')).toBeInTheDocument();
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });

  it('shows the success message', () => {
    render(<OTPInput status="success" successMessage="Código confirmado." aria-label="Código" />);
    expect(screen.getByText('Código confirmado.')).toBeInTheDocument();
  });
});

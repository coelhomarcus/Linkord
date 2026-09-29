import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OutdatedClientScreen } from '@/app/layout/OutdatedClientScreen';

afterEach(() => vi.unstubAllGlobals());

describe('OutdatedClientScreen', () => {
  it('warns that a new version exists and reassures about the data', () => {
    render(<OutdatedClientScreen />);
    expect(screen.getByRole('alert')).toHaveTextContent('Há uma versão nova do Linkord');
    expect(screen.getByRole('alert')).toHaveTextContent(/conversas e amizades continuam/);
  });

  it('the button reloads the page', async () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    const user = userEvent.setup();
    render(<OutdatedClientScreen />);
    await user.click(screen.getByRole('button', { name: 'Atualizar a página' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

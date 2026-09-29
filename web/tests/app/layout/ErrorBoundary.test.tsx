import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ErrorBoundary } from '@/app/layout/ErrorBoundary';
import { logger } from '@/shared/lib/logger';

afterEach(() => vi.restoreAllMocks());

function Boom(): never { throw new Error('render exploded'); }

describe('ErrorBoundary', () => {
  it('renders children normally', () => {
    render(<ErrorBoundary><p>all good</p></ErrorBoundary>);
    expect(screen.getByText('all good')).toBeInTheDocument();
  });

  it('on a render error shows the recovery screen (instead of a blank screen) and logs the error', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<ErrorBoundary><Boom /></ErrorBoundary>);
    expect(screen.getByRole('alert')).toHaveTextContent('Algo deu errado');
    const record = logger.recent().findLast((r) => r.message === 'render error');
    expect(record?.level).toBe('error');
    expect(JSON.stringify(record?.fields)).toMatch(/render exploded/);
  });

  it('the button reloads the page', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    const user = userEvent.setup();
    render(<ErrorBoundary><Boom /></ErrorBoundary>);
    await user.click(screen.getByRole('button', { name: 'Recarregar' }));
    expect(reload).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});

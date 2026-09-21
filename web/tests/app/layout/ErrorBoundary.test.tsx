import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ErrorBoundary } from '@/app/layout/ErrorBoundary';
import { logger } from '@/shared/lib/logger';

afterEach(() => vi.restoreAllMocks());

function Boom(): never { throw new Error('render exploded'); }

describe('ErrorBoundary', () => {
  it('renderiza os filhos normalmente', () => {
    render(<ErrorBoundary><p>tudo certo</p></ErrorBoundary>);
    expect(screen.getByText('tudo certo')).toBeInTheDocument();
  });

  it('num erro de render mostra a tela de recuperacao (em vez de tela em branco) e registra o erro', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<ErrorBoundary><Boom /></ErrorBoundary>);
    expect(screen.getByRole('alert')).toHaveTextContent('Algo deu errado');
    const record = logger.recent().findLast((r) => r.message === 'render error');
    expect(record?.level).toBe('error');
    expect(JSON.stringify(record?.fields)).toMatch(/render exploded/);
  });

  it('o botao recarrega a pagina', async () => {
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

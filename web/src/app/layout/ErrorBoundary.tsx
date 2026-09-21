import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { Button } from '@/shared/ui/primitives/button';
import { logger } from '@/shared/lib/logger';

const log = logger.child({ component: 'render' });

/** Without this a render error leaves a blank screen and no trace. It reports
 * the error (with the component stack) and offers a reload. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    log.error('render error', error, { componentStack: (info.componentStack ?? '').split('\n').slice(0, 8).join('\n') });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="flex h-dvh items-center justify-center bg-bg-primary p-4">
        <div role="alert" className="flex w-full max-w-100 flex-col gap-3.5 rounded-xl bg-bg-floating p-6">
          <h1 className="text-display font-bold text-text-primary">Algo deu errado</h1>
          <p className="text-body text-text-secondary">Aconteceu um erro inesperado e ele já foi registrado. Recarregue a página para continuar.</p>
          <Button type="button" size="lg" onClick={() => location.reload()}>Recarregar</Button>
        </div>
      </div>
    );
  }
}

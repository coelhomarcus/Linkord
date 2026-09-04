import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// desmonta qualquer componente montado no teste anterior — sem isso, dois
// testes de componente em arquivos diferentes poderiam deixar DOM residual
// um pro outro (jsdom persiste entre testes do mesmo arquivo/processo).
afterEach(() => {
  cleanup();
});

// jsdom nao implementa ResizeObserver nem window.matchMedia — os componentes
// de UI (@base-ui/react, por trás de Dialog/Select/Tooltip/DropdownMenu)
// esperam os dois pra calcular posicionamento/breakpoints. Sem isso, so
// MONTAR um Dialog/Select em teste ja lanca "ResizeObserver is not defined".
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
if (typeof window.matchMedia === 'undefined') {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList;
}

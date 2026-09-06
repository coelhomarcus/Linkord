import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Node 26 exposes a configurable `globalThis.localStorage` accessor, but it
// returns undefined unless Node itself was started with --localstorage-file.
// Vitest sees that the property already exists and does not replace it with
// jsdom's implementation. Vitest exposes the original (unpopulated) window
// as `globalThis.jsdom.window`; `window` and `document.defaultView` already
// point back to the populated Node global by the time setup files execute.
// Bind the test global to the original jsdom storage so the suite behaves the
// same on Node 22 and newer supported Node versions.
const jsdomLocalStorage = (globalThis as typeof globalThis & {
  jsdom?: { window?: Window };
}).jsdom?.window?.localStorage;
if (!jsdomLocalStorage) throw new Error('jsdom localStorage indisponivel no ambiente de teste');
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  enumerable: true,
  value: jsdomLocalStorage,
});

// unmounts anything rendered by the previous test — otherwise two
// component tests in different files could leave DOM behind for each
// other (jsdom persists across tests in the same file/process).
afterEach(() => {
  cleanup();
  localStorage.clear();
});

// jsdom implements neither ResizeObserver nor window.matchMedia — the UI
// components (@base-ui/react, behind Dialog/Select/Tooltip/DropdownMenu)
// expect both to compute positioning/breakpoints. Without this, just
// MOUNTING a Dialog/Select in a test throws "ResizeObserver is not defined".
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

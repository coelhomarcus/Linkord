import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// unmounts anything rendered by the previous test — otherwise two
// component tests in different files could leave DOM behind for each
// other (jsdom persists across tests in the same file/process).
afterEach(() => {
  cleanup();
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
// jsdom doesn't implement these either — used for local previews (pending
// chat attachments, the profile photo/banner crop step) before anything is
// actually uploaded.
if (typeof URL.createObjectURL === 'undefined') {
  URL.createObjectURL = () => 'blob:mock';
  URL.revokeObjectURL = () => {};
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

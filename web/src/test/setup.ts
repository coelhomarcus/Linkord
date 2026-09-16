import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
if (typeof globalThis.IntersectionObserver === 'undefined') {
  // Fires "intersecting" as soon as something is observed — nothing in this
  // app relies on lazy-load-on-scroll actually staying deferred under test,
  // and this keeps every "fetch when it scrolls into view" component
  // exercised by default instead of every test having to fake a scroll.
  globalThis.IntersectionObserver = class {
    callback: IntersectionObserverCallback;
    constructor(callback: IntersectionObserverCallback) {
      this.callback = callback;
    }
    observe(target: Element) {
      this.callback([{ isIntersecting: true, target } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
    }
    unobserve() {}
    disconnect() {}
    takeRecords(): IntersectionObserverEntry[] { return []; }
    root = null;
    rootMargin = '';
    thresholds: ReadonlyArray<number> = [];
  } as unknown as typeof IntersectionObserver;
}
if (typeof globalThis.AudioWorkletNode === 'undefined') {
  // @sapphi-red/web-noise-suppressor declares `class RnnoiseWorkletNode
  // extends AudioWorkletNode` (and its Gtcrn/NoiseGate/Speex siblings, all
  // from the same module) at module scope, so just importing it — which
  // useMicrophone.ts does transitively via rnnoiseAudioProcessor.ts, even
  // when noise suppression is never turned on — throws in jsdom (no Web
  // Audio API at all) without this.
  globalThis.AudioWorkletNode = class {} as unknown as typeof AudioWorkletNode;
}
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

import { createRef } from 'react';
import type { RefObject } from 'react';
import { useOutletContext } from 'react-router';
import type { AdminMode } from './useAdminLayout';

export interface AdminOutletContext {
  mode: AdminMode;
  /** the scrolling column of the area, for pages that restore a position */
  scroller: RefObject<HTMLElement | null>;
}

/** Lets a routed page know which navigation surface is showing (the bare
 * /admin entry is the index in compact and a redirect in wide). */
export function useAdminMode(): AdminMode {
  // a page rendered outside the layout (a test, a future standalone use) is wide
  return useOutletContext<AdminOutletContext | undefined>()?.mode ?? 'wide';
}

const NO_SCROLLER = createRef<HTMLElement>();

export function useAdminScroller(): RefObject<HTMLElement | null> {
  return useOutletContext<AdminOutletContext | undefined>()?.scroller ?? NO_SCROLLER;
}

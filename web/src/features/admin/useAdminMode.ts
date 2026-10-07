import { createRef } from 'react';
import type { RefObject } from 'react';
import { useOutletContext } from 'react-router';
import type { AdminMode } from './useAdminLayout';

export interface AdminOutletContext {
  mode: AdminMode;
  /** false until the area has been measured once: `mode` is only a guess before that */
  measured: boolean;
  /** the content column is wide enough for a table of 5–6 columns (see ADMIN_TABLE_MIN) */
  tableFits: boolean;
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

/** Whether `mode` is a measurement yet. A page that REDIRECTS on the mode (the
 * bare /admin entry) must wait for it, or it acts on the guess. */
export function useAdminMeasured(): boolean {
  return useOutletContext<AdminOutletContext | undefined>()?.measured ?? true;
}

/** Whether lists render as tables (true) or as stacked rows. Not the same
 * question as `useAdminMode`: the sidebar needs the AREA to be wide, a table
 * needs the CONTENT column to be — with the conversation list open on a laptop
 * the area is wide while the column beside the sidebar is not. */
export function useAdminTableFits(): boolean {
  return useOutletContext<AdminOutletContext | undefined>()?.tableFits ?? true;
}

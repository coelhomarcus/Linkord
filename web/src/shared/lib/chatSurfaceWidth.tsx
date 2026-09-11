import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode, RefObject } from 'react';

// Media attachments (video/audio/image/embeds) size themselves in JS with an
// explicit pixel width — necessary for aspect-ratio math — rather than a CSS
// percentage, because their real parent (the message bubble) is a flex item
// that hugs its own content: a percentage width there is circular (the
// bubble's size depends on the child, the child's percent depends on the
// bubble) and resolves to the wrong thing. That JS width used to be a single
// hardcoded constant tuned for the wide main chat panel; once attachments
// could also render inside a ~360px chat sidebar (call view), that constant
// overflowed the narrower surface. This context carries "how wide is the
// chat surface these bubbles are laid out in" down to the media players, so
// they can size against reality instead of one guess.
const ChatSurfaceWidthContext = createContext<number | null>(null);

/** Wrap a chat surface (the main conversation panel, a chat sidebar, ...) so
 * descendant media players know how much room they actually have. `width`
 * is the surface's own content width in px — a live measurement for a
 * surface that resizes, or a constant for a fixed-width one. */
export function ChatSurfaceWidthProvider({ width, children }: { width: number | null; children: ReactNode }) {
  return <ChatSurfaceWidthContext.Provider value={width}>{children}</ChatSurfaceWidthContext.Provider>;
}

/** The chat surface's measured content width, or `fallback` outside any
 * ChatSurfaceWidthProvider (e.g. component tests). */
export function useChatSurfaceWidth(fallback: number): number {
  return useContext(ChatSurfaceWidthContext) ?? fallback;
}

// Between the chat surface's own edge and an attachment's content box sit:
// the message list's scroll padding (MessageList, px-2 both sides), the
// message row's own padding (MessageRow, px-4 both sides), and the avatar
// column + its gap (w-10 + gap-3) on the left only. There's no bubble
// anymore (see MessageRow) so no bubble padding to add on top.
const ROW_CHROME_OVERHEAD = 100;
const MIN_ATTACHMENT_WIDTH = 120;

/** How wide an attachment (video/audio/image/embed) can render before it
 * risks overflowing the chat surface it's laid out in — `cap` is the
 * attachment's own preferred max (e.g. 384 for a mini video). */
export function availableAttachmentWidth(surfaceWidth: number, cap: number): number {
  return Math.max(MIN_ATTACHMENT_WIDTH, Math.min(cap, surfaceWidth - ROW_CHROME_OVERHEAD));
}

/** Tracks `ref`'s own rendered content width for a surface whose width isn't
 * a fixed constant (e.g. the main panel, which grows/shrinks with the
 * window and sidebars) — feed the result into ChatSurfaceWidthProvider. */
export function useMeasuredWidth(ref: RefObject<HTMLElement | null>): number | null {
  const [width, setWidth] = useState<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width;
      if (next) setWidth(next);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);

  return width;
}

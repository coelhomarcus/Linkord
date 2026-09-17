"use client";
// beui.dev/components/blocks/command-palette

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowLeft, ChevronRight, Search, type LucideIcon } from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { EASE_OUT } from "@/shared/lib/ease";
import { useOnOpen } from "@/shared/hooks/use-on-open";
import { useRowCursor } from "@/shared/hooks/use-row-cursor";
import { useTouchCapable } from "@/shared/hooks/use-touch-capable";
import { PresenceGate } from "@/shared/lib/presence-gate";
import { cn } from "@/shared/lib/utils";
import { searchCommands } from "@/shared/lib/command-search";

export type CommandItem = {
  id: string;
  label: string;
  group?: string;
  hint?: string;
  keywords?: string[];
  icon?: LucideIcon;
  /** A richer leading visual (a user/group avatar) instead of `icon` — takes
   * precedence over it when both are given. Expected to already be sized for
   * the row (see the h-5 w-5 wrapper below); callers own their own shape/fit. */
  avatar?: ReactNode;
  badge?: ReactNode;
  /** Terminal items call this and close the palette. Omit it (and set
   * `stage` instead) for an item that drills into a sub-list rather than
   * doing something itself — see `stage` below. */
  onSelect?: () => void;
  /** Turns this item into a step rather than a leaf: selecting it swaps the
   * visible list to `stage.items` and resets the search box instead of
   * running `onSelect`/closing. The user backs out with Backspace (on an
   * empty query), Escape, or the back button — see the root keydown handler
   * and the header back button below. Items inside a stage are ordinary
   * `CommandItem`s (their own `onSelect` runs as normal), so nesting more
   * than one level deep works too, it's just not used anywhere yet. */
  stage?: { items: CommandItem[]; placeholder?: string };
};

export interface CommandPaletteProps {
  items: CommandItem[];
  /** Opens with Cmd/Ctrl + this key. Default: "k" */
  shortcut?: string;
  placeholder?: string;
  emptyMessage?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

// Opened via a keyboard shortcut many times a day — entrance must read as
// instant. Tight spring, even faster exit.
const PANEL_SPRING = {
  type: "spring",
  stiffness: 560,
  damping: 40,
  mass: 0.5,
} as const;

export function CommandPalette({
  items,
  shortcut = "k",
  placeholder = "Type a command or search…",
  emptyMessage = "No results found.",
  open: controlledOpen,
  onOpenChange,
}: CommandPaletteProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const controlled = controlledOpen !== undefined;
  const open = controlled ? controlledOpen : internalOpen;
  const setOpen = useCallback(
    (v: boolean) => {
      if (!controlled) setInternalOpen(v);
      onOpenChange?.(v);
    },
    [controlled, onOpenChange],
  );

  const [query, setQuery] = useState("");
  // Stack of entered stages (see CommandItem.stage) — empty means "at the
  // root list". A plain array, not just a single optional stage, so nesting
  // deeper than one level works for free if something ever needs it.
  const [stagePath, setStagePath] = useState<CommandItem[]>([]);
  const popStage = useCallback(() => {
    setStagePath((path) => path.slice(0, -1));
    setQuery("");
  }, []);
  // Portal target only exists client-side; render nothing during SSR/hydration.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const uid = useId();
  const reduce = useReducedMotion();
  const canTouch = useTouchCapable();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        (e.metaKey || e.ctrlKey) &&
        e.key.toLowerCase() === shortcut.toLowerCase()
      ) {
        e.preventDefault();
        setOpen(!open);
        return;
      }
      if (e.key === "Escape" && open) {
        e.preventDefault();
        // One Escape backs out of a stage; only closes once back at the root.
        if (stagePath.length > 0) popStage();
        else setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, shortcut, setOpen, stagePath, popStage]);

  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    const previousRootOverflow = root.style.overflow;
    const previousBodyOverflow = document.body.style.overflow;
    root.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    return () => {
      root.style.overflow = previousRootOverflow;
      document.body.style.overflow = previousBodyOverflow;
    };
  }, [open]);

  // The list currently on screen — the root `items`, or whichever stage is
  // on top of the stack.
  const activeItems = stagePath.length > 0 ? stagePath[stagePath.length - 1]!.stage!.items : items;
  const activeStage = stagePath[stagePath.length - 1];

  const filtered = useMemo(() => searchCommands(activeItems, query), [activeItems, query]);

  // Reserve the icon column only when at least one item brings an icon or an
  // avatar, so icon-less lists don't render a dead gap before every label.
  const hasIcons = useMemo(() => activeItems.some((it) => it.icon || it.avatar), [activeItems]);

  const grouped = useMemo(() => {
    const map = new Map<string, CommandItem[]>();
    filtered.forEach((it) => {
      const g = it.group ?? "Results";
      const groupItems = map.get(g) ?? [];
      groupItems.push(it);
      map.set(g, groupItems);
    });
    return Array.from(map.entries());
  }, [filtered]);

  // Grouping reorders the list, so the rendered order is not the filtered
  // order whenever two groups interleave. Everything that has to agree on
  // "which row" — the highlight, the ids, Enter, the scroll — reads this one
  // array, so they cannot drift apart.
  const rows = useMemo(() => grouped.flatMap(([, list]) => list), [grouped]);

  const { activeIndex: active, moveTo, moveActive } = useRowCursor(rows, query);

  // Clearing the query would drop the cursor on its own, but only if it had
  // changed; `moveTo(null)` covers reopening on an already-empty query.
  // Every fresh open also starts back at the root stage.
  useOnOpen(open, () => {
    setQuery("");
    moveTo(null);
    setStagePath([]);
  });

  // Also refocuses on every stage change: entering/leaving a stage swaps out
  // the row that was just clicked, so the DOM node holding focus unmounts and
  // focus would otherwise fall back to the body — silently swallowing the
  // next keystroke (e.g. Backspace-to-go-back) since it never reaches this
  // panel's onKeyDown. Called directly (no rAF) since the input is already in
  // the DOM by the time this effect runs.
  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
  }, [open, stagePath]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      moveActive(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      moveActive(-1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const it = rows[active];
      if (!it) return;
      if (it.stage) {
        setStagePath((path) => [...path, it]);
        setQuery("");
        moveTo(null);
      } else {
        it.onSelect?.();
        setOpen(false);
      }
    } else if (e.key === "Backspace" && query === "" && stagePath.length > 0) {
      // Nothing to delete at an empty query — steps back a level instead.
      e.preventDefault();
      popStage();
    }
  };

  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLButtonElement>(
      `[data-index="${active}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  if (!mounted) return null;

  // Portaled to <body> so ancestors with transforms, filters, or fixed
  // positioning can't trap the overlay in their stacking context, and mounted
  // only while open. The chrome is two fixed siblings rather than one wrapper:
  // the backdrop spans the viewport edges but carries the scrim colour, and the
  // layer positioning the panel is inset off every edge. Both hang off
  // `PresenceGate`, so interaction releases in the same commit that starts the
  // exit rather than when it ends — `open` is already false for those frames.
  return createPortal(
    <AnimatePresence initial={false}>
      {open ? (
        <PresenceGate key="backdrop">
          {({ gate }) => (
            <motion.button
              type="button"
              aria-label="Close command palette"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{
                opacity: 0,
                transition: { duration: 0.12, ease: EASE_OUT },
              }}
              transition={{ duration: 0.18, ease: EASE_OUT }}
              {...gate}
              onClick={() => setOpen(false)}
              className="pointer-events-auto fixed inset-0 z-[100] bg-background/5 [backdrop-filter:blur(12px)_saturate(140%)] [-webkit-backdrop-filter:blur(12px)_saturate(140%)]"
            />
          )}
        </PresenceGate>
      ) : null}

      {open ? (
        <PresenceGate key="panel-layer">
          {({ isPresent, gate }) => (
            // The layer itself never takes pointer events, so it carries
            // `inert` alone rather than the gate's pointer-events value.
            <div
              inert={!isPresent}
              className="pointer-events-none fixed inset-x-4 bottom-4 top-[18vh] z-[100] flex items-start justify-center"
            >
              <motion.div
                role="dialog"
                aria-modal="true"
                aria-label="Command palette"
                initial={{
                  opacity: 0,
                  y: reduce ? 0 : -8,
                  scale: reduce ? 1 : 0.97,
                }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{
                  opacity: 0,
                  y: reduce ? 0 : -8,
                  scale: reduce ? 1 : 0.97,
                  transition: { duration: 0.12, ease: EASE_OUT },
                }}
                transition={reduce ? { duration: 0.1 } : PANEL_SPRING}
                {...gate}
                onKeyDown={onKeyDown}
                className="pointer-events-auto w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-card shadow-2xl will-change-transform"
              >
                <div className="flex items-center gap-3 border-b border-border px-4">
                  {stagePath.length > 0 ? (
                    <button
                      type="button"
                      aria-label="Voltar"
                      onClick={popStage}
                      className="flex-none text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <ArrowLeft className="h-4 w-4" />
                    </button>
                  ) : (
                    <Search className="h-4 w-4 flex-none text-muted-foreground" />
                  )}
                  <input
                    ref={inputRef}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={activeStage?.stage?.placeholder ?? placeholder}
                    role="combobox"
                    // The field only exists while the palette is open.
                    aria-expanded="true"
                    aria-controls={`${uid}-list`}
                    aria-activedescendant={
                      rows.length > 0 ? `${uid}-opt-${active}` : undefined
                    }
                    aria-autocomplete="list"
                    className={cn(
                      "h-12 flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none",
                      // The palette focuses this field the moment it opens, and iOS
                      // zooms the page in on a focused field under 16px: the fixed
                      // overlay is magnified off-center — clipped leading edge, half
                      // an icon column — and the zoom outlives the palette. 16px on
                      // touch keeps the page at scale 1; pointer devices keep 14px.
                      canTouch && "text-base",
                    )}
                  />
                  <kbd className="hidden rounded border border-border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground sm:inline-block">
                    ESC
                  </kbd>
                </div>
                <div
                  ref={listRef}
                  id={`${uid}-list`}
                  role="listbox"
                  aria-label="Commands"
                  className="max-h-[60vh] overflow-y-auto overscroll-contain p-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                >
                  {rows.length === 0 ? (
                    <div className="p-8 text-center text-sm text-muted-foreground">
                      {emptyMessage}
                    </div>
                  ) : (
                    grouped.map(([group, list]) => (
                      <div key={group} className="mb-1 last:mb-0">
                        <div
                          aria-hidden
                          className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
                        >
                          {group}
                        </div>
                        {list.map((it) => {
                          // `rows` holds these very objects, in render order.
                          const idx = rows.indexOf(it);
                          const isActive = idx === active;
                          const Icon = it.icon;
                          return (
                            <button
                              key={it.id}
                              type="button"
                              id={`${uid}-opt-${idx}`}
                              role="option"
                              aria-selected={isActive}
                              data-index={idx}
                              onMouseEnter={() => moveTo(it.id)}
                              onClick={() => {
                                if (it.stage) {
                                  setStagePath((path) => [...path, it]);
                                  setQuery("");
                                  moveTo(null);
                                } else {
                                  it.onSelect?.();
                                  setOpen(false);
                                }
                              }}
                              className={cn(
                                "relative isolate flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm transition-colors",
                                isActive
                                  ? "text-foreground"
                                  : "text-muted-foreground",
                              )}
                            >
                              {isActive ? (
                                <motion.span
                                  layoutId={`${uid}-active`}
                                  className="absolute inset-0 z-0 rounded-md bg-primary/[0.05]"
                                  transition={
                                    reduce
                                      ? { duration: 0 }
                                      : // Tracks rapid arrow-key navigation — keep it tighter
                                        // than SPRING_LAYOUT so it never lags the active row.
                                        {
                                          type: "spring",
                                          stiffness: 480,
                                          damping: 38,
                                        }
                                  }
                                />
                              ) : null}
                              {it.avatar ? (
                                <span className="relative z-10 flex h-5 w-5 flex-none items-center justify-center overflow-hidden rounded-full">
                                  {it.avatar}
                                </span>
                              ) : Icon ? (
                                <Icon className="relative z-10 h-4 w-4 flex-none" />
                              ) : hasIcons ? (
                                <span className="relative z-10 h-4 w-4 flex-none" />
                              ) : null}
                              <span className="relative z-10 flex-1 truncate">
                                {it.label}
                              </span>
                              {it.badge ? (
                                <span className="relative z-10 shrink-0">
                                  {it.badge}
                                </span>
                              ) : null}
                              {it.stage ? (
                                <ChevronRight className="relative z-10 h-3.5 w-3.5 flex-none text-muted-foreground" />
                              ) : it.hint ? (
                                <kbd className="relative z-10 rounded border border-border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                  {it.hint}
                                </kbd>
                              ) : null}
                            </button>
                          );
                        })}
                      </div>
                    ))
                  )}
                </div>
              </motion.div>
            </div>
          )}
        </PresenceGate>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

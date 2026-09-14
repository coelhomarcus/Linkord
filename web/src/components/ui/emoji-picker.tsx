"use client";

import { useEffect, useRef } from "react";

import { cn } from "@/shared/lib/utils";

export interface EmojiSelection {
  emoji: string;
}

interface EmojiPickerProps {
  className?: string;
  onEmojiSelect: (selection: EmojiSelection) => void;
}

// emoji-mart's <em-emoji-picker> is a plain custom element (registered by
// importing `emoji-mart`, not a React component) — mounted imperatively here
// instead of via @emoji-mart/react, whose declared peer range (React 16-18)
// doesn't cover React 19 yet even though the element itself doesn't touch
// React internals and works fine regardless. Both the library itself
// (~160KB, it bundles its own UI + styles) and the emoji dataset
// (@emoji-mart/data, ~400KB uncompressed) are dynamically imported so they
// load as their own chunks the first time a picker actually opens, never
// bundled into the main app.
export function EmojiPicker({ className, onEmojiSelect }: EmojiPickerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const onEmojiSelectRef = useRef(onEmojiSelect);
  onEmojiSelectRef.current = onEmojiSelect;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let picker: HTMLElement | null = null;
    let cancelled = false;

    Promise.all([import("emoji-mart"), import("@emoji-mart/data")]).then(([{ Picker }, { default: data }]) => {
      if (cancelled) return;
      picker = new Picker({
        data,
        onEmojiSelect: (emoji: { native: string }) => onEmojiSelectRef.current({ emoji: emoji.native }),
        theme: "dark",
        locale: "pt",
        previewPosition: "none",
        skinTonePosition: "search",
        dynamicWidth: true,
      }) as unknown as HTMLElement;
      container.appendChild(picker);
    });

    return () => {
      cancelled = true;
      picker?.remove();
    };
  }, []);

  return (
    <div
      ref={containerRef}
      data-slot="emoji-picker"
      className={cn("[&_em-emoji-picker]:block [&_em-emoji-picker]:h-full [&_em-emoji-picker]:w-full", className)}
    />
  );
}

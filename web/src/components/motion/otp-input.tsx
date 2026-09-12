"use client";

import {
  AnimatePresence,
  animate,
  motion,
  useReducedMotion,
} from "motion/react";
import { useEffect, useId, useRef, useState } from "react";
import { EASE_OUT } from "@/shared/lib/ease";
import { cn } from "@/shared/lib/utils";

export type OTPStatus = "idle" | "error" | "success";

export interface OTPInputProps {
  length?: number;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  onComplete?: (value: string) => void;
  label?: string;
  hint?: string;
  successMessage?: string;
  errorMessage?: string;
  status?: OTPStatus;
  mask?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
  "aria-label"?: string;
  className?: string;
}

export function OTPInput({
  length = 6,
  value: controlledValue,
  defaultValue = "",
  onChange,
  onComplete,
  label,
  hint,
  successMessage,
  errorMessage,
  status = "idle",
  mask = false,
  disabled = false,
  autoFocus = false,
  "aria-label": ariaLabel = "Código de uso único",
  className,
}: OTPInputProps) {
  const uid = useId();
  const reduce = useReducedMotion();
  const inputRef = useRef<HTMLInputElement>(null);
  const slotsRef = useRef<HTMLDivElement>(null);
  const controlled = controlledValue !== undefined;
  const [slots, setSlots] = useState<string[]>(() => toSlots(controlled ? controlledValue : defaultValue, length));
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(0);
  const joined = slots.join("");
  const joinedRef = useRef(joined);

  useEffect(() => { joinedRef.current = joined; }, [joined]);

  useEffect(() => {
    if (!controlled) return;
    const incoming = sanitize(controlledValue, length);
    if (incoming !== joinedRef.current) setSlots(toSlots(incoming, length));
  }, [controlled, controlledValue, length]);

  const commit = (next: string[]) => {
    const wasComplete = slots.every((char) => char !== "");
    setSlots(next);
    const value = next.join("");
    onChange?.(value);
    if (!wasComplete && next.every((char) => char !== "")) onComplete?.(value);
  };

  const clearSlot = (index: number) => {
    const next = [...slots];
    next[index] = "";
    commit(next);
  };

  const slotFromClientX = (clientX: number) => {
    const elements = slotsRef.current?.children;
    if (!elements) return 0;
    for (let index = 0; index < elements.length; index++) {
      if (clientX < elements[index].getBoundingClientRect().right) return index;
    }
    return length - 1;
  };

  const insert = (raw: string, from = active) => {
    const digits = raw.replace(/\D/g, "");
    if (!digits) return;
    const next = [...slots];
    let index = from;
    for (const digit of digits) {
      if (index >= length) break;
      next[index] = digit;
      index++;
    }
    commit(next);
    setActive(Math.min(index, length - 1));
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (disabled || event.metaKey || event.ctrlKey || event.altKey) return;
    const key = event.key;
    if (/^[0-9]$/.test(key)) {
      event.preventDefault();
      insert(key);
    } else if (key === "Backspace") {
      event.preventDefault();
      if (slots[active]) clearSlot(active);
      else if (active > 0) {
        clearSlot(active - 1);
        setActive((current) => Math.max(current - 1, 0));
      }
    } else if (key === "Delete") {
      event.preventDefault();
      clearSlot(active);
    } else if (key === "ArrowLeft") {
      event.preventDefault();
      setActive((current) => Math.max(current - 1, 0));
    } else if (key === "ArrowRight") {
      event.preventDefault();
      setActive((current) => Math.min(current + 1, length - 1));
    } else if (key === "Home") {
      event.preventDefault();
      setActive(0);
    } else if (key === "End") {
      event.preventDefault();
      setActive(length - 1);
    }
  };

  const onPaste = (event: React.ClipboardEvent<HTMLInputElement>) => {
    if (disabled) return;
    event.preventDefault();
    insert(event.clipboardData.getData("text"), active);
  };

  const onChangeNative = (event: React.ChangeEvent<HTMLInputElement>) => {
    const digits = sanitize(event.target.value, length);
    if (!digits) return;
    commit(toSlots(digits, length));
    setActive(Math.min(digits.length, length - 1));
  };

  useEffect(() => {
    if (status !== "error" || reduce || !slotsRef.current) return;
    animate(slotsRef.current, { x: [0, -5, 5, -3, 3, -1, 0] }, { duration: 0.45, ease: EASE_OUT });
  }, [status, reduce]);

  const showSuccess = status === "success";
  const activeIndex = focused ? active : -1;
  const message = showSuccess ? successMessage : status === "error" ? errorMessage : hint;

  return (
    <div className={cn("inline-flex flex-col gap-2", className)}>
      {label ? <label htmlFor={`${uid}-input`} className="text-sm font-medium text-foreground">{label}</label> : null}
      <fieldset
        className="relative m-0 inline-flex w-max border-0 p-0"
        onMouseDown={(event) => {
          if (disabled) return;
          event.preventDefault();
          const firstEmpty = slots.indexOf("");
          const cap = firstEmpty === -1 ? length - 1 : firstEmpty;
          setActive(Math.min(slotFromClientX(event.clientX), cap));
          inputRef.current?.focus();
        }}
      >
        <input
          ref={inputRef}
          id={`${uid}-input`}
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus={autoFocus}
          disabled={disabled}
          aria-label={ariaLabel}
          aria-invalid={status === "error"}
          value=""
          maxLength={length}
          onKeyDown={onKeyDown}
          onChange={onChangeNative}
          onPaste={onPaste}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          className="absolute inset-0 z-20 h-full w-full cursor-text bg-transparent text-transparent caret-transparent opacity-0 outline-none disabled:cursor-not-allowed"
        />
        <div ref={slotsRef} className="flex items-center gap-2">
          {Array.from({ length }, (_, index) => {
            const char = slots[index] ?? "";
            const isActive = index === activeIndex;
            return (
              <div
                key={`${uid}-${index}`}
                data-active={isActive}
                data-filled={char !== ""}
                className={cn(
                  "relative grid h-14 w-12 place-items-center overflow-hidden rounded-xl border text-xl font-semibold tabular-nums transition-colors duration-200",
                  showSuccess ? "border-emerald-500/60 text-foreground" : status === "error" ? "border-destructive/60 text-foreground" : char ? "border-border-strong text-foreground" : "border-border text-muted-foreground",
                  isActive && !showSuccess && status !== "error" && "border-foreground",
                  disabled && "opacity-50",
                )}
              >
                {isActive && !showSuccess ? (
                  <motion.span
                    aria-hidden
                    animate={reduce ? undefined : { opacity: [1, 1, 0, 0] }}
                    transition={reduce ? undefined : { duration: 1, repeat: Number.POSITIVE_INFINITY, ease: "linear" }}
                    className={cn("pointer-events-none absolute top-1/2 h-6 w-px -translate-y-1/2 bg-foreground", char ? "right-3" : "left-1/2 -translate-x-1/2")}
                  />
                ) : null}
                <AnimatePresence initial={false}>
                  {char ? (
                    <motion.span
                      key={char}
                      initial={reduce ? { opacity: 0 } : { y: 14, opacity: 0, filter: "blur(4px)" }}
                      animate={reduce ? { opacity: 1 } : { y: 0, opacity: 1, filter: "blur(0px)" }}
                      exit={reduce ? { opacity: 0 } : { y: -14, opacity: 0, filter: "blur(4px)" }}
                      transition={reduce ? { duration: 0 } : { duration: 0.22, ease: EASE_OUT }}
                      className="absolute inset-0 grid place-items-center leading-none"
                    >
                      {mask ? "•" : char}
                    </motion.span>
                  ) : null}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
        <AnimatePresence>
          {showSuccess ? (
            <motion.span
              initial={reduce ? { opacity: 0 } : { scale: 0.6, opacity: 0 }}
              animate={reduce ? { opacity: 1 } : { scale: 1, opacity: 1 }}
              exit={reduce ? { opacity: 0 } : { scale: 0.6, opacity: 0 }}
              transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 500, damping: 28 }}
              className="pointer-events-none absolute -right-7 top-1/2 -translate-y-1/2 text-emerald-500"
              aria-hidden
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
                <title>Verificado</title>
                <motion.path d="M5 13l4 4L19 7" initial={reduce ? { pathLength: 1 } : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={reduce ? { duration: 0 } : { duration: 0.35, ease: EASE_OUT, delay: 0.1 }} />
              </svg>
            </motion.span>
          ) : null}
        </AnimatePresence>
      </fieldset>
      {message ? <p aria-live="polite" className={cn("text-sm", showSuccess ? "text-emerald-500" : status === "error" ? "text-destructive" : "text-muted-foreground")}>{message}</p> : null}
    </div>
  );
}

function sanitize(raw: string | undefined, length: number): string {
  return String(raw ?? "").replace(/\D/g, "").slice(0, length);
}

function toSlots(raw: string | undefined, length: number): string[] {
  const digits = sanitize(raw, length);
  return Array.from({ length }, (_, index) => digits[index] ?? "");
}

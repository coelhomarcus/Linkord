import type { ReactNode } from 'react';
import { cn } from '@/shared/lib/utils';

interface CountBadgeProps {
  /** Set when the badge is the ONLY place announcing the count — otherwise
   * the surrounding control (a button's own aria-label, a row's text
   * content) already says it, and this stays out of the accessible name. */
  label?: string;
  /** True when a parent already fully names itself (e.g. via its own
   * aria-label) and this badge's text would otherwise be redundant. */
  decorative?: boolean;
  className?: string;
  children: ReactNode;
}

/** A small circular count ("1", "12", "99+"). `min-w` alone (to let "99+"
 * widen into a pill) without a matching fixed height used to make this an
 * oval, not a circle — height came from line-height alone, shorter than the
 * width floor. `h-4.5` pins it: a perfect circle for 1-2 digits, a pill once
 * content pushes past that. Same base size everywhere; a caller with a
 * bigger context (e.g. a conversation row) overrides height, min-width,
 * padding and text size together via `className`, never height alone. */
export function CountBadge({ label, decorative, className, children }: CountBadgeProps) {
  return (
    <span
      aria-label={label}
      aria-hidden={decorative ? true : undefined}
      className={cn(
        'grid h-4.5 min-w-4.5 place-items-center rounded-full bg-primary px-1 text-[10px] font-bold leading-none text-primary-foreground',
        className,
      )}
    >
      {children}
    </span>
  );
}

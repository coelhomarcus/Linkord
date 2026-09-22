import { useId } from 'react';
import type { ComponentProps, ReactNode, Ref } from 'react';
import { cn } from '@/shared/lib/utils';

/** The reading column of a category: capped width, sections stacked vertically
 * with a divider between them. Padding follows the width of the settings area
 * (container queries), not the window. */
export function SettingsContent({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('w-full max-w-[760px] px-4 py-6 @[520px]:px-6 @[960px]:px-8 @[960px]:py-8', className)} {...props} />;
}

export function SettingsPageHeader({ title, description, headingRef, hideTitle }: {
  title: string;
  description?: ReactNode;
  headingRef?: Ref<HTMLHeadingElement>;
  /** the page header already shows it (compact detail): keep it for screen readers and focus */
  hideTitle?: boolean;
}) {
  return (
    <header className={cn('flex flex-col gap-1', hideTitle ? 'mb-4' : 'mb-6')}>
      <h2 ref={headingRef} tabIndex={-1} className={cn('text-display font-bold text-text-primary outline-none', hideTitle && 'sr-only')}>{title}</h2>
      {description && <p className="text-label text-text-muted">{description}</p>}
    </header>
  );
}

/** The sections of one category, separated by a discreet divider. */
export function SettingsSections({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('flex flex-col gap-6', className)} {...props} />;
}

export function SettingsSection({ id, title, description, children, className }: {
  /** stable id, also the hash target (/app/settings/av#microphone) */
  id?: string;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  const headingId = useId();
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      // Not natively focusable — a search result landing here (SettingsPage's
      // hash effect) needs somewhere real to move focus to, not just scroll.
      tabIndex={id ? -1 : undefined}
      className={cn('flex scroll-mt-20 flex-col gap-3 border-t border-white/10 pt-6 first:border-t-0 first:pt-0 outline-none', className)}
    >
      <div className="flex flex-col gap-0.5">
        <h3 id={headingId} className="text-title font-semibold text-text-primary">{title}</h3>
        {description && <p className="text-label text-text-muted">{description}</p>}
      </div>
      {children}
    </section>
  );
}

/** One setting: what it is and what it does on the left, the control on the right
 * when there is room (it wraps under the text when there isn't). */
export function SettingsRow({ label, description, htmlFor, children, className }: {
  label: ReactNode;
  description?: ReactNode;
  /** id of the control this row labels */
  htmlFor?: string;
  children?: ReactNode;
  className?: string;
}) {
  const Label = htmlFor ? 'label' : 'p';
  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-x-6 gap-y-2', className)}>
      <div className="min-w-0 flex-1 basis-56">
        <Label {...(htmlFor ? { htmlFor } : {})} className="block text-body font-medium text-text-primary">{label}</Label>
        {description && <p className="text-label text-text-muted">{description}</p>}
      </div>
      {children && <div className="flex min-w-0 flex-none flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/shared/lib/utils';

/** Title and one line of context at the top of a settings tab — on a wide
 * screen the tab would otherwise open straight into a grid of cards. */
export function SettingsPanelHeader({ title, description }: { title: string; description?: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <h2 className="text-title font-semibold text-text-primary">{title}</h2>
      {description && <p className="select-none text-label text-text-muted">{description}</p>}
    </div>
  );
}

/** Cards side by side as many as fit: the column count follows the width of the
 * area (24 rem minimum per column) instead of fixed breakpoints, so a narrow
 * window gets one column and a wide one uses the space. */
export function SettingsGrid({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('grid grid-cols-[repeat(auto-fill,minmax(min(100%,24rem),1fr))] items-start gap-4', className)} {...props} />;
}

import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/shared/lib/utils';

/** A semantic table whose overflow stays in its own region — never on the page.
 * Used on the wide layout only; compact screens render stacked rows instead,
 * one presentation mounted at a time so assistive tech doesn't read both. */
export function AdminTable({ caption, children, className }: { caption: string; children: ReactNode; className?: string }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-white/10">
      <table className={cn('w-full min-w-[640px] border-collapse text-left', className)}>
        <caption className="sr-only">{caption}</caption>
        {children}
      </table>
    </div>
  );
}

export function AdminTh({ className, ...props }: ComponentProps<'th'>) {
  return <th scope="col" className={cn('overflow-hidden text-ellipsis whitespace-nowrap border-b border-white/10 bg-white/[0.02] px-3 py-2 text-caption font-medium uppercase tracking-[0.02em] text-text-muted', className)} {...props} />;
}

export function AdminTd({ className, ...props }: ComponentProps<'td'>) {
  return <td className={cn('h-14 border-b border-white/5 px-3 align-middle text-label text-text-secondary group-last/row:border-b-0', className)} {...props} />;
}

export function AdminTr({ className, ...props }: ComponentProps<'tr'>) {
  return <tr className={cn('group/row transition-colors hover:bg-white/[0.03]', className)} {...props} />;
}

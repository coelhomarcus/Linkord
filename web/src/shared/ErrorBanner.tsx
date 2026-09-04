import type { ReactNode } from 'react';
import { cn } from '@/shared/lib/utils';

export function ErrorBanner({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-sm bg-red/12 px-3.5 py-3 text-body text-red-text', className)}>
      {children}
    </div>
  );
}

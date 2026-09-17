import type { ComponentProps } from 'react';
import { cn } from '@/shared/lib/utils';

export const sectionLabelClass = 'select-none text-caption font-bold uppercase tracking-[0.02em] text-text-secondary';

export function SectionLabel({ className, ...props }: ComponentProps<'p'>) {
  return <p className={cn(sectionLabelClass, className)} {...props} />;
}

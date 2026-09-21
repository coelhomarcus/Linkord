import type { ReactNode } from 'react';
import { PageHeader } from '@/shared/PageHeader';

/** Shared frame for the friends/requests pages: header + a scrolling body. */
export function SocialPageLayout({ title, subtitle, actions, children }: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title={title} subtitle={subtitle} actions={actions} />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-6">{children}</div>
    </div>
  );
}

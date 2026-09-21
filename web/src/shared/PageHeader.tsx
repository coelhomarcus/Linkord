import type { ReactNode } from 'react';
import { PanelLeft } from 'lucide-react';
import { useAnimatedSidebar } from '@/shared/ui/motion/animated-sidebar';
import { Button } from '@/shared/ui/primitives/button';

/** Header of a full-page screen (friends, requests, settings). On mobile the
 * sidebar is a sheet, so a page has no other way back to the conversation
 * list — the header carries the button that reopens it. */
export function PageHeader({ title, subtitle, actions, leading }: { title: string; subtitle?: string; actions?: ReactNode; leading?: ReactNode }) {
  const { isMobile, setOpenMobile } = useAnimatedSidebar();
  return (
    <header className="flex flex-none items-center gap-3 border-b border-white/10 px-4 py-3 md:px-6">
      {isMobile && (
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Abrir lista de conversas" onClick={() => setOpenMobile(true)}>
          <PanelLeft size={18} />
        </Button>
      )}
      {leading}
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-title font-semibold text-text-primary">{title}</h1>
        {subtitle && <p className="truncate text-caption text-text-muted">{subtitle}</p>}
      </div>
      {actions}
    </header>
  );
}

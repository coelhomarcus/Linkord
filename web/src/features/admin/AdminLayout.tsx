import { useEffect, useRef } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Link, Outlet, useLocation } from 'react-router';
import { PageHeader } from '@/shared/PageHeader';
import { buttonVariants } from '@/shared/ui/primitives/button';
import { ADMIN_PATH, sectionForPath } from './adminCatalog';
import { AdminSidebar } from './AdminNavigation';
import { useAdminLayout } from './useAdminLayout';
import type { AdminOutletContext } from './useAdminMode';

/** Shell of the administrative area: header, section sidebar (wide) or index
 * (compact), and one scrolling content column that uses the whole width left
 * over by the rail and the conversation sidebar. */
export function AdminLayout() {
  const areaRef = useRef<HTMLDivElement | null>(null);
  const scrollerRef = useRef<HTMLElement | null>(null);
  const firstRender = useRef(true);
  const { pathname } = useLocation();
  const mode = useAdminLayout(areaRef);
  const section = sectionForPath(pathname);
  const compactSection = mode === 'compact' && section !== null;

  // opening another page starts at its top instead of inheriting the previous scroll
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    scrollerRef.current?.scrollTo?.({ top: 0 });
  }, [pathname]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title={compactSection ? section.label : 'Administração'}
        subtitle={mode === 'wide' ? section?.label : undefined}
        leading={compactSection ? (
          <Link to={ADMIN_PATH} aria-label="Voltar à administração" className={buttonVariants({ variant: 'ghost', size: 'icon-sm' })}>
            <ArrowLeft size={18} aria-hidden />
          </Link>
        ) : undefined}
      />
      <div ref={areaRef} className="@container flex min-h-0 min-w-0 flex-1">
        {mode === 'wide' ? <AdminSidebar /> : null}
        <main ref={scrollerRef} aria-label={section?.label ?? 'Administração'} className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          <div className="flex w-full flex-col gap-4 px-4 py-4 @[520px]:px-6 @[960px]:px-8 @[960px]:py-6">
            <Outlet context={{ mode } satisfies AdminOutletContext} />
          </div>
        </main>
      </div>
    </div>
  );
}

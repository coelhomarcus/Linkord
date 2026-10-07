import { useEffect, useRef, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router';
import { PageHeader } from '@/shared/PageHeader';
import { Button, buttonVariants } from '@/shared/ui/primitives/button';
import { ROUTES } from '@/shared/lib/routes';
import { useRoom } from '@/state/RoomContext';
import { subscribeAdminAccessLost } from './adminAccess';
import { consumeScrollRestore, invalidateAdminLists } from './adminListCache';
import { ADMIN_PATH, sectionForPath } from './adminCatalog';
import { AdminSidebar } from './AdminNavigation';
import { useAdminLayout } from './useAdminLayout';
import type { AdminOutletContext } from './useAdminMode';

/** Shown when the server stopped treating this account as an administrator.
 * The pages are gone by then (their data, dialogs and pending reads with them);
 * leaving also fixes the stale role so the guard and the rail agree. */
function AccessLost() {
  const { dispatch } = useRoom();
  const navigate = useNavigate();
  return (
    <div role="alert" className="flex flex-col items-center gap-3 py-12 text-center">
      <h2 className="text-title font-semibold text-text-primary">Você não tem mais acesso à administração</h2>
      <p className="max-w-md text-label text-text-muted">Sua conta deixou de ser administradora ou foi suspensa. Nada foi alterado pela última ação.</p>
      <Button type="button" onClick={() => { dispatch({ type: 'SET_ROLE', role: 'user' }); navigate(ROUTES.conversations, { replace: true }); }}>
        Voltar às conversas
      </Button>
    </div>
  );
}

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
  const [accessLost, setAccessLost] = useState(false);

  useEffect(() => subscribeAdminAccessLost(() => { invalidateAdminLists(); setAccessLost(true); }), []);
  // remembered list windows belong to this visit of the area
  useEffect(() => invalidateAdminLists, []);

  // opening another page starts at its top instead of inheriting the previous scroll
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    // a list that just restored its own position keeps it
    if (consumeScrollRestore()) return;
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
        {mode === 'wide' && !accessLost ? <AdminSidebar /> : null}
        <main ref={scrollerRef} aria-label={section?.label ?? 'Administração'} className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          <div className="flex w-full flex-col gap-4 px-4 py-4 @[520px]:px-6 @[960px]:px-8 @[960px]:py-6">
            {accessLost ? <AccessLost /> : <Outlet context={{ mode, scroller: scrollerRef } satisfies AdminOutletContext} />}
          </div>
        </main>
      </div>
    </div>
  );
}

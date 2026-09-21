import { useEffect, useRef } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router';
import { useRoom } from '@/state/RoomContext';
import { PageHeader } from '@/shared/PageHeader';
import { Button } from '@/shared/ui/primitives/button';
import { ROUTES, isSettingsTab } from '@/shared/lib/routes';
import type { SettingsTab } from '@/shared/lib/routes';
import { AccountSettings } from './AccountSettings';
import { AdminLinkTab } from './AdminLinkTab';
import { AudioVideoSettings } from './AudioVideoSettings';
import { NotificationsSettings } from './NotificationsSettings';
import { PreferencesSettings } from './PreferencesSettings';
import { PrivacyTab } from './PrivacyTab';
import { ProfileSettings } from './ProfileSettings';
import { SettingsContent, SettingsPageHeader } from './SettingsLayout';
import { SettingsIndex, SettingsSidebar } from './SettingsNavigation';
import { findCategory } from './settingsCatalog';
import { useSettingsLayout } from './useSettingsLayout';

interface SettingsPageProps {
  onOpenProfile: (userId: string) => void;
}

function CategoryPage({ tab, onOpenProfile }: { tab: SettingsTab; onOpenProfile: (userId: string) => void }) {
  switch (tab) {
    case 'profile': return <ProfileSettings />;
    case 'account': return <AccountSettings />;
    case 'privacy': return <PrivacyTab onOpenProfile={onOpenProfile} />;
    case 'av': return <AudioVideoSettings />;
    case 'notifications': return <NotificationsSettings />;
    case 'prefs': return <PreferencesSettings />;
    case 'moderation': return <AdminLinkTab />;
  }
}

export function SettingsPage({ onOpenProfile }: SettingsPageProps) {
  const { state } = useRoom();
  const { tab } = useParams<{ tab?: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const areaRef = useRef<HTMLDivElement | null>(null);
  const scrollerRef = useRef<HTMLElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const mode = useSettingsLayout(areaRef);
  const firstRender = useRef(true);
  const isAdmin = state.me.role === 'admin';

  const known = isSettingsTab(tab) && (tab !== 'moderation' || isAdmin);
  const active: SettingsTab | null = known ? tab : null;
  // wide: no category in the URL just means "the first one", on the same URL;
  // compact: it is the index
  const showIndex = mode === 'compact' && active === null;
  const current: SettingsTab = active ?? 'profile';
  const category = findCategory(current);

  // opening another category starts at its top, with its title focused; a hash
  // (/app/settings/av#camera) wins and scrolls to that section instead
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      if (!location.hash) return;
    }
    if (location.hash) {
      document.getElementById(location.hash.slice(1))?.scrollIntoView?.({ block: 'start' });
      return;
    }
    scrollerRef.current?.scrollTo?.({ top: 0 });
    headingRef.current?.focus({ preventScroll: true });
  }, [current, showIndex, location.hash]);

  // an unknown category — or the admin-only one for a non-admin — falls back to
  // the first one instead of rendering an empty page
  if (tab !== undefined && !known) return <Navigate to={ROUTES.settingsTab('profile')} replace />;

  const compactDetail = mode === 'compact' && active !== null;
  const fromIndex = (location.state as { fromIndex?: boolean } | null)?.fromIndex === true;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title={compactDetail ? category.label : 'Ajustes'}
        leading={compactDetail ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Voltar às configurações"
            onClick={() => (fromIndex ? navigate(-1) : navigate(ROUTES.settings))}
          >
            <ArrowLeft size={18} aria-hidden />
          </Button>
        ) : undefined}
      />
      <div ref={areaRef} className="@container flex min-h-0 min-w-0 flex-1">
        {mode === 'wide' ? <SettingsSidebar active={current} isAdmin={isAdmin} /> : null}
        <main ref={scrollerRef} aria-label={showIndex ? 'Ajustes' : category.label} className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          {showIndex ? (
            <SettingsIndex isAdmin={isAdmin} />
          ) : (
            <SettingsContent>
              <SettingsPageHeader title={category.label} description={category.description} headingRef={headingRef} hideTitle={compactDetail} />
              <CategoryPage tab={current} onOpenProfile={onOpenProfile} />
            </SettingsContent>
          )}
        </main>
      </div>
    </div>
  );
}

import { useCallback, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router';
import { PageHeader } from '@/shared/PageHeader';
import { useElementWidth } from '@/shared/hooks/useElementWidth';
import { parseFriendsView } from '@/shared/lib/routes';
import { AddFriendView } from './AddFriendView';
import { AddFriendButton, FriendsModeNav, FriendsModeSelect } from './FriendsHeader';
import type { FriendsHeaderLayout } from './FriendsHeader';
import { FriendsList } from './FriendsList';
import { GroupInvitationsView } from './GroupInvitationsView';
import { PendingRequestsView } from './PendingRequestsView';

// Where the header switches arrangement, measured on the page AREA (the space
// left after the sidebars), not on the window
const INLINE_MIN = 800;
const ROW_MIN = 520;

function headerLayoutFor(width: number): FriendsHeaderLayout {
  if (width <= 0 || width >= INLINE_MIN) return 'inline'; // 0 = not measured yet
  return width >= ROW_MIN ? 'row' : 'select';
}

/** Friends, pending requests, group invitations and adding people — one page. The
 * view (`?tab=`) and the search (`?q=`) live in the URL. */
export function FriendsPage({ onOpenProfile }: { onOpenProfile: (userId: string) => void }) {
  const [params, setParams] = useSearchParams();
  const rawTab = params.get('tab');
  const view = parseFriendsView(rawTab);
  const query = params.get('q') ?? '';
  const areaRef = useRef<HTMLDivElement | null>(null);
  const layout = headerLayoutFor(useElementWidth(areaRef));

  // an unknown (or redundant `all`) tab is normalised in place, never an empty page
  useEffect(() => {
    if (rawTab === null || (rawTab !== 'all' && rawTab === view)) return;
    const next = new URLSearchParams(params);
    next.delete('tab');
    setParams(next, { replace: true });
  }, [rawTab, view, params, setParams]);

  // typing replaces the entry: Back goes to the previous view, not to each keystroke
  const setQuery = useCallback((next: string) => {
    setParams((current) => {
      const updated = new URLSearchParams(current);
      if (next) updated.set('q', next); else updated.delete('q');
      return updated;
    }, { replace: true });
  }, [setParams]);

  return (
    <div ref={areaRef} className="@container flex h-full min-h-0 flex-col">
      <PageHeader
        title="Amigos"
        middle={layout === 'inline' ? <FriendsModeNav view={view} className="ml-2" /> : undefined}
        actions={<AddFriendButton active={view === 'add'} iconOnly={layout === 'select'} />}
      />
      {layout === 'row' && <FriendsModeNav view={view} className="flex-none border-b border-white/10 px-4 py-2 md:px-6" />}
      {layout === 'select' && <div className="flex-none border-b border-white/10 px-4 py-2"><FriendsModeSelect view={view} /></div>}
      <main aria-label="Amigos" className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-6">
        {(view === 'all' || view === 'online') && (
          <FriendsList key={view} view={view} query={query} onQueryChange={setQuery} onOpenProfile={onOpenProfile} />
        )}
        {view === 'pending' && <PendingRequestsView query={query} onQueryChange={setQuery} onOpenProfile={onOpenProfile} />}
        {view === 'invitations' && <GroupInvitationsView query={query} onQueryChange={setQuery} onOpenProfile={onOpenProfile} />}
        {view === 'add' && <AddFriendView />}
      </main>
    </div>
  );
}

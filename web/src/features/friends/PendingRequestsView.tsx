import { useEffect } from 'react';
import { useLocation } from 'react-router';
import { FriendRequestList } from './FriendRequestList';
import { useFriends } from './FriendsContext';
import { ListSearch } from './ListSearch';
import { ListSectionHeader } from './ListSectionHeader';
import { useUrlSearch } from './useUrlSearch';

/** Received and sent requests in one scroll, each with its own pagination. The
 * hash (#received / #sent) is a direct link to a section. */
export function PendingRequestsView({ query, onQueryChange, onOpenProfile }: { query: string; onQueryChange: (next: string) => void; onOpenProfile: (userId: string) => void }) {
  const { pendingFriendRequestCount } = useFriends();
  const { value, setValue, search } = useUrlSearch(query, onQueryChange);
  const { hash } = useLocation();

  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView?.({ block: 'start' });
  }, [hash]);

  return (
    <div className="flex flex-col gap-6">
      <ListSearch value={value} onChange={setValue} label="Buscar nas solicitações" />
      <section id="received" aria-labelledby="received-title" className="scroll-mt-4">
        <ListSectionHeader id="received-title" title="Recebidas" count={!search && pendingFriendRequestCount > 0 ? `${pendingFriendRequestCount} aguardando resposta` : undefined} />
        <FriendRequestList direction="incoming" search={search} onOpenProfile={onOpenProfile} />
      </section>
      <section id="sent" aria-labelledby="sent-title" className="scroll-mt-4">
        <ListSectionHeader id="sent-title" title="Enviadas" />
        <FriendRequestList direction="outgoing" search={search} onOpenProfile={onOpenProfile} />
      </section>
    </div>
  );
}

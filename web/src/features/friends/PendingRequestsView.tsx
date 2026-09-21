import { useEffect } from 'react';
import { useLocation } from 'react-router';
import { FriendRequestList } from './FriendRequestList';
import { useFriends } from './FriendsContext';
import { ListSectionHeader } from './ListSectionHeader';

/** Received and sent requests in one scroll, each with its own pagination. The
 * hash (#received / #sent) is a direct link to a section. */
export function PendingRequestsView({ onOpenProfile }: { onOpenProfile: (userId: string) => void }) {
  const { pendingFriendRequestCount } = useFriends();
  const { hash } = useLocation();

  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView?.({ block: 'start' });
  }, [hash]);

  return (
    <div className="flex flex-col gap-8">
      <section id="received" aria-labelledby="received-title" className="scroll-mt-4">
        <ListSectionHeader id="received-title" title="Recebidas" count={pendingFriendRequestCount > 0 ? `${pendingFriendRequestCount} aguardando resposta` : undefined} />
        <FriendRequestList direction="incoming" onOpenProfile={onOpenProfile} />
      </section>
      <section id="sent" aria-labelledby="sent-title" className="scroll-mt-4">
        <ListSectionHeader id="sent-title" title="Enviadas" />
        <FriendRequestList direction="outgoing" onOpenProfile={onOpenProfile} />
      </section>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { fetchUnreadNotificationCount } from '@/shared/api/api';
import { useFriends } from '@/features/friends/FriendsContext';

/** Unread count for the bell. Refetched on the same revision that drives the
 * requests badge (the server's payload-free social-changed hint plus local
 * bumps), so it follows live changes without its own socket handling. */
export function useUnreadNotifications() {
  const { revision } = useFriends();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetchUnreadNotificationCount()
      .then((res) => { if (!cancelled) setUnread(res.unread); })
      .catch(() => { /* a hint only — keep the previous number */ });
    return () => { cancelled = true; };
  }, [revision]);

  return { unread, setUnread };
}

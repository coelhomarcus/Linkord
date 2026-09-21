import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useRoom } from '@/state/RoomContext';
import { fetchRequestSummary } from '@/shared/api/api';

interface FriendsContextValue {
  /** Changes whenever friends/requests/blocks may have changed — from the
   * server (`social-changed`) or from an action this tab just took. Lists
   * refetch off it instead of patching themselves. */
  revision: number;
  bump: () => void;
  pendingIncomingCount: number;
}

const FriendsContext = createContext<FriendsContextValue | null>(null);

// Social state belongs to this feature, not to the room reducer
// (docs/plano-rede-social.md §8.1): the room only forwards the server's
// payload-free signal as `socialRevision`, everything else lives here.
export function FriendsProvider({ children }: { children: ReactNode }) {
  const { socialRevision } = useRoom();
  const [localBumps, setLocalBumps] = useState(0);
  const [pendingIncomingCount, setPendingIncomingCount] = useState(0);
  const revision = socialRevision + localBumps;

  const bump = useCallback(() => setLocalBumps((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    fetchRequestSummary()
      .then((summary) => { if (!cancelled) setPendingIncomingCount(summary.incoming); })
      .catch(() => { /* the badge is a hint — a failed fetch just leaves the old number */ });
    return () => { cancelled = true; };
  }, [revision]);

  const value = useMemo(() => ({ revision, bump, pendingIncomingCount }), [revision, bump, pendingIncomingCount]);
  return <FriendsContext.Provider value={value}>{children}</FriendsContext.Provider>;
}

export function useFriends(): FriendsContextValue {
  const ctx = useContext(FriendsContext);
  if (!ctx) throw new Error('useFriends must be used inside <FriendsProvider>');
  return ctx;
}

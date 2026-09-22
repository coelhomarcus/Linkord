import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useRoom } from '@/state/RoomContext';
import { fetchRequestSummary } from '@/shared/api/api';

export type SummaryStatus = 'loading' | 'ready' | 'stale';

const RESUMMARY_MIN_MS = 10_000;

interface FriendsContextValue {
  /** `loading` until the first read lands: the counts below are then unknown, not zero. `stale` = the last read failed and they are the previous ones. */
  summaryStatus: SummaryStatus;
  /** Changes whenever friends/requests/blocks may have changed — from the
   * server (`social-changed`) or from an action this tab just took. Lists
   * refetch off it instead of patching themselves. */
  revision: number;
  bump: () => void;
  /** Friend requests waiting on this user's answer. */
  pendingFriendRequestCount: number;
  /** Everything waiting on this user's answer: friend requests + group invitations. */
  pendingIncomingCount: number;
  pendingInvitationCount: number;
}

const FriendsContext = createContext<FriendsContextValue | null>(null);

// Social state belongs to this feature, not to the room reducer
// (docs/plano-rede-social.md §8.1): the room only forwards the server's
// payload-free signal as `socialRevision`, everything else lives here.
export function FriendsProvider({ children }: { children: ReactNode }) {
  const { socialRevision } = useRoom();
  const [localBumps, setLocalBumps] = useState(0);
  const [focusReads, setFocusReads] = useState(0);
  const [summary, setSummary] = useState({ incoming: 0, invitations: 0 });
  const [summaryStatus, setSummaryStatus] = useState<SummaryStatus>('loading');
  const revision = socialRevision + localBumps;

  const bump = useCallback(() => setLocalBumps((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    fetchRequestSummary()
      .then((res) => {
        if (cancelled) return;
        setSummary({ incoming: res.incoming, invitations: res.invitations ?? 0 });
        setSummaryStatus('ready');
      })
      // the badge is a hint: a failed read keeps the last valid number, marked stale
      .catch(() => { if (!cancelled) setSummaryStatus((status) => (status === 'ready' ? 'stale' : status)); });
    return () => { cancelled = true; };
  }, [revision, focusReads]);

  // coming back to the tab (or the window) re-reads the counts — a change that
  // happened while the socket was asleep would otherwise stay invisible. Throttled.
  useEffect(() => {
    let last = Date.now();
    const reread = () => {
      if (document.visibilityState === 'hidden' || Date.now() - last < RESUMMARY_MIN_MS) return;
      last = Date.now();
      setFocusReads((n) => n + 1);
    };
    window.addEventListener('focus', reread);
    document.addEventListener('visibilitychange', reread);
    return () => {
      window.removeEventListener('focus', reread);
      document.removeEventListener('visibilitychange', reread);
    };
  }, []);

  const value = useMemo(() => ({
    revision, bump, summaryStatus,
    pendingFriendRequestCount: summary.incoming,
    pendingIncomingCount: summary.incoming + summary.invitations,
    pendingInvitationCount: summary.invitations,
  }), [revision, bump, summary, summaryStatus]);
  return <FriendsContext.Provider value={value}>{children}</FriendsContext.Provider>;
}

export function useFriends(): FriendsContextValue {
  const ctx = useContext(FriendsContext);
  if (!ctx) throw new Error('useFriends must be used inside <FriendsProvider>');
  return ctx;
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchRelationship } from '@/shared/api/api';
import type { Relationship } from '@/shared/api/api';
import { useFriends } from './FriendsContext';

export type RelationshipState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; value: Relationship };

/** The viewer's relation to one account, kept current: refetches when the
 * social revision moves (a second tab accepted, the other side blocked...).
 * The answer is stored WITH the account it belongs to, so switching accounts
 * shows "loading" until the right answer lands — never the previous account's
 * relation — while a live refresh of the same account keeps the current one. */
export function useRelationship(userId: string | null): { state: RelationshipState; retry: () => void } {
  const { revision } = useFriends();
  const [answer, setAnswer] = useState<{ userId: string; state: RelationshipState } | null>(null);
  const generation = useRef(0);

  const load = useCallback(() => {
    if (!userId) return;
    const mine = ++generation.current;
    fetchRelationship(userId)
      .then((value) => { if (mine === generation.current) setAnswer({ userId, state: { status: 'ready', value } }); })
      .catch(() => { if (mine === generation.current) setAnswer({ userId, state: { status: 'error' } }); });
  }, [userId]);

  useEffect(() => { load(); }, [load, revision]);

  const retry = useCallback(() => {
    setAnswer(null);
    load();
  }, [load]);

  const state: RelationshipState = answer && answer.userId === userId ? answer.state : { status: 'loading' };
  return { state, retry };
}

import { useEffect, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useRoom } from '@/state/RoomContext';
import { ROUTES, conversationIdFromPath, conversationIdFromState, conversationNav, isAwaitingOpen } from '@/shared/lib/routes';

/** Keeps the conversation named by the history entry and the room's
 * `activeConversationId` in agreement without either one being "the" source of
 * truth — the active conversation is opened from many places (sidebar, palette,
 * notifications, a group just created) that know nothing about history.
 *
 * The id lives in the entry's `state`, never in the path (which stays
 * `/app/conversations`); a legacy `/app/conversations/:id` link is rewritten
 * to that shape. Each direction reacts ONLY to its own source changing, and
 * each one is a no-op when both already agree — that is what prevents the two
 * from fighting:
 *   entry → state : the entry's id changed (legacy link, back/forward, refresh)
 *   state → entry : the active conversation changed
 *   bare entry    : /app/conversations with an active conversation gets its id */
export function useConversationRouteSync(): void {
  const { conversations, activeConversationId, openConversation, state } = useRoom();
  const location = useLocation();
  const navigate = useNavigate();
  const joined = state.joined;
  const legacyPathId = conversationIdFromPath(location.pathname);
  const stateId = conversationIdFromState(location.state);
  const isBare = location.pathname === ROUTES.conversations || location.pathname === `${ROUTES.conversations}/`;
  const requestedId = legacyPathId ?? (isBare ? stateId : null);
  const awaitingOpen = isAwaitingOpen(location.state);

  const knownIds = useMemo(() => new Set(conversations.map((c) => c.id)), [conversations]);
  const requestedIdKnown = requestedId !== null && knownIds.has(requestedId);

  // Read inside the effects below instead of listed as dependencies: each
  // effect must re-run ONLY when its own source changes, or it turns into an
  // echo of the other side. `navigate` is the sharp one — with BrowserRouter
  // its identity changes on every route change, so listing it made the
  // state→entry effect re-run after going to /app/friends and drag the user
  // straight back to the active conversation. Declared first so they are
  // already fresh when those effects run in the same commit.
  const activeRef = useRef(activeConversationId);
  const pathRef = useRef(location.pathname);
  const stateIdRef = useRef(stateId);
  const navigateRef = useRef(navigate);
  const openRef = useRef(openConversation);
  useEffect(() => {
    activeRef.current = activeConversationId;
    pathRef.current = location.pathname;
    stateIdRef.current = stateId;
    navigateRef.current = navigate;
    openRef.current = openConversation;
  }, [activeConversationId, location.pathname, stateId, navigate, openConversation]);

  useEffect(() => {
    if (!joined || requestedId === null) return;
    if (!requestedIdKnown) {
      navigateRef.current(ROUTES.conversations, { replace: true });
      return;
    }
    if (requestedId !== activeRef.current) openRef.current(requestedId);
    if (legacyPathId !== null) navigateRef.current(ROUTES.conversations, { replace: true, ...conversationNav(legacyPathId) });
  }, [joined, requestedId, requestedIdKnown, legacyPathId]);

  // The first active conversation is the one auto-selected right after
  // connecting — not a navigation the user asked for, so it must not drag a
  // deep link to /app/friends over to a conversation.
  const skippedAutoSelectRef = useRef(false);
  useEffect(() => {
    if (!joined || !activeConversationId) return;
    if (!skippedAutoSelectRef.current) {
      skippedAutoSelectRef.current = true;
      return;
    }
    const current = pathRef.current;
    const onBare = current === ROUTES.conversations || current === `${ROUTES.conversations}/`;
    if (onBare && stateIdRef.current === activeConversationId) return;
    // sitting on the bare entry (no conversation named yet) means this open IS
    // the one it was waiting for — replace it instead of stacking a second entry
    navigateRef.current(ROUTES.conversations, { replace: onBare && stateIdRef.current === null, ...conversationNav(activeConversationId) });
  }, [joined, activeConversationId]);

  useEffect(() => {
    if (!joined || !isBare || stateId !== null || awaitingOpen || !activeConversationId) return;
    navigateRef.current(ROUTES.conversations, { replace: true, ...conversationNav(activeConversationId) });
  }, [joined, isBare, stateId, awaitingOpen, activeConversationId]);
}

import { useEffect, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useRoom } from '@/state/RoomContext';
import { ROUTES, conversationIdFromPath, isAwaitingOpen } from '@/shared/lib/routes';

/** Keeps `/app/conversations/:id` and the room's `activeConversationId` in
 * agreement without either one being "the" source of truth — the active
 * conversation is opened from many places (sidebar, palette, notifications, a
 * group just created) that know nothing about URLs.
 *
 * Each direction reacts ONLY to its own source changing, and each one is a
 * no-op when both already agree — that is what prevents the two from fighting:
 *   URL → state : the path's id changed (deep link, back/forward)
 *   state → URL : the active conversation changed
 *   bare route  : /app/conversations with an active conversation gets its id */
export function useConversationRouteSync(): void {
  const { conversations, activeConversationId, openConversation, state } = useRoom();
  const location = useLocation();
  const navigate = useNavigate();
  const joined = state.joined;
  const urlId = conversationIdFromPath(location.pathname);
  const isBare = location.pathname === ROUTES.conversations || location.pathname === `${ROUTES.conversations}/`;
  const awaitingOpen = isAwaitingOpen(location.state);

  const knownIds = useMemo(() => new Set(conversations.map((c) => c.id)), [conversations]);
  const urlIdKnown = urlId !== null && knownIds.has(urlId);

  // Read inside the effects below instead of listed as dependencies: each
  // effect must re-run ONLY when its own source changes, or it turns into an
  // echo of the other side. `navigate` is the sharp one — with BrowserRouter
  // its identity changes on every route change, so listing it made the
  // state→URL effect re-run after going to /app/friends and drag the user
  // straight back to the active conversation. Declared first so they are
  // already fresh when those effects run in the same commit.
  const activeRef = useRef(activeConversationId);
  const pathRef = useRef(location.pathname);
  const navigateRef = useRef(navigate);
  const openRef = useRef(openConversation);
  useEffect(() => {
    activeRef.current = activeConversationId;
    pathRef.current = location.pathname;
    navigateRef.current = navigate;
    openRef.current = openConversation;
  }, [activeConversationId, location.pathname, navigate, openConversation]);

  useEffect(() => {
    if (!joined || urlId === null) return;
    if (!urlIdKnown) {
      navigateRef.current(ROUTES.conversations, { replace: true });
      return;
    }
    if (urlId !== activeRef.current) openRef.current(urlId);
  }, [joined, urlId, urlIdKnown]);

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
    const target = ROUTES.conversation(activeConversationId);
    const current = pathRef.current;
    if (current === target) return;
    // sitting on the bare route means this open IS the one it was waiting
    // for — replace it instead of stacking a second history entry
    navigateRef.current(target, { replace: current === ROUTES.conversations || current === `${ROUTES.conversations}/` });
  }, [joined, activeConversationId]);

  useEffect(() => {
    if (!joined || !isBare || awaitingOpen || !activeConversationId) return;
    navigateRef.current(ROUTES.conversation(activeConversationId), { replace: true });
  }, [joined, isBare, awaitingOpen, activeConversationId]);
}

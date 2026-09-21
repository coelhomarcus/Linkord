import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router';
import { RoomProvider } from '@/app/providers/RoomProvider';
import { useRoom } from '@/state/RoomContext';
import { AuthProvider, useAuth } from '@/state/AuthContext';
import { AuthScreen } from '@/features/auth/AuthScreen';
import { EmailRequiredModal } from '@/features/auth/EmailRequiredModal';
import { RoomErrorScreen } from '@/app/layout/RoomErrorScreen';
import { OutdatedClientScreen } from '@/app/layout/OutdatedClientScreen';
import { LoadingScreen } from '@/app/layout/LoadingScreen';
import { ReconnectBanner } from '@/app/layout/ReconnectBanner';
import { AccessNotice } from '@/app/layout/AccessNotice';
import { ConversationSidebar } from '@/features/conversations/ConversationSidebar';
import { ConversationPanel } from '@/features/conversations/ConversationPanel';
import { GroupDetailsPanel } from '@/features/conversations/GroupDetailsPanel';
import { ConversationMediaPanel } from '@/features/conversations/ConversationMediaPanel';
import { ChatSearchDialog } from '@/features/chat/ChatSearchDialog';
import { Stage } from '@/features/calls/Stage';
import { CallControlBar } from '@/features/calls/CallControlBar';
import { CallChatToggleButton } from '@/features/calls/CallChatToggleButton';
import { CallChatPanel } from '@/features/calls/CallChatPanel';
import { ParticipantAudioLayer } from '@/features/calls/ParticipantAudioLayer';
import { FloatingPip } from '@/features/calls/FloatingPip';
import { useParticipantMedia } from '@/features/calls/useLiveKitTrack';
import { callParticipantIds, conversationTitle } from '@/features/conversations/conversationUtils';
import { TileMenu } from '@/features/calls/TileMenu';
import { ReactionsOverlay } from '@/features/reactions/ReactionsOverlay';
import { GlobalContextMenu } from '@/app/layout/GlobalContextMenu';
import { ProfileModal } from '@/features/profile/ProfileModal';
import { FriendsProvider } from '@/features/friends/FriendsContext';
import { FriendsPage } from '@/features/friends/FriendsPage';
import { RequestsRedirect } from '@/features/friends/RequestsRedirect';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { AWAITING_OPEN, ROUTES, isConversationsPath } from '@/shared/lib/routes';
import { useConversationRouteSync } from '@/app/useConversationRouteSync';
import { AnimatedSidebarInset, AnimatedSidebarProvider, useAnimatedSidebar } from '@/shared/ui/motion/animated-sidebar';
import { CommandPalette } from '@/shared/ui/motion/command-palette';
import { buildCommandItems } from '@/features/conversations/commandPaletteItems';
import { loadSidebarCollapsed, saveSidebarCollapsed } from '@/shared/hooks/useSidebarCollapsedPreference';
import { TooltipProvider } from '@/shared/ui/primitives/tooltip';

// the administrative area is its own chunk: ordinary users never download it
const AdminArea = lazy(() => import('@/features/admin/AdminArea'));

function Shell() {
  const {
    state, dispatch, livekitRoom, closeTileMenu, sendWs, notifyActiveView, registerRequestChatView,
    activeCallConversationId, activeConversationId, joinCall, conversations, allUsers,
  } = useRoom();
  const [activeView, setActiveView] = useState<'chat' | 'call'>('chat');
  const roomError = state.roomError;
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const onConversations = isConversationsPath(pathname);
  const [profileUserId, setProfileUserId] = useState<string | null>(null);
  // Landing straight on a page (a deep link, a refresh on /app/friends) should
  // show that page — the sidebar sheet is only the landing screen when the URL
  // names no page at all.
  const [mobileShowSidebar, setMobileShowSidebar] = useState(() => {
    const path = window.location.pathname.replace(/\/$/, '');
    return path === '' || path === '/app' || path === ROUTES.conversations;
  });
  const [searchOpen, setSearchOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [mediaOpen, setMediaOpen] = useState(false);
  const [callChatOpen, setCallChatOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const [sidebarOpen, setSidebarOpenState] = useState(() => !loadSidebarCollapsed());
  const setSidebarOpen = useCallback((next: boolean) => {
    setSidebarOpenState(next);
    saveSidebarCollapsed(!next);
  }, []);

  useEffect(() => { notifyActiveView(activeView); }, [activeView, notifyActiveView]);

  // The first conversation auto-selected right after connecting shouldn't
  // drill in on mobile (the sidebar list is the intended landing screen).
  // Every LATER change to activeConversationId is a
  // real navigation the user should actually see: a group they just
  // created, a notification click, or anything else that opens a
  // conversation without going through the sidebar row's own onClick (which
  // already closes the mobile sheet directly). Without this, those left the
  // active conversation switched behind an unchanged, still-open sidebar.
  const hasAutoSelectedInitialConversationRef = useRef(false);
  useEffect(() => {
    if (!activeConversationId) return;
    if (!hasAutoSelectedInitialConversationRef.current) {
      hasAutoSelectedInitialConversationRef.current = true;
      return;
    }
    setMobileShowSidebar(false);
  }, [activeConversationId]);

  useConversationRouteSync();

  // "Show me the chat": from a notification click or the palette, possibly
  // while on the friends/settings page. window.location (not the hook's
  // pathname) on purpose — callers navigate() explicitly in the same handler
  // just before this, and only the real location is already up to date then.
  useEffect(() => {
    registerRequestChatView(() => {
      setActiveView('chat');
      if (!isConversationsPath(window.location.pathname)) navigate(ROUTES.conversations, AWAITING_OPEN);
    });
  }, [registerRequestChatView, navigate]);

  const publishing = state.me.sharing || state.me.cameraOn;

  const myMedia = useParticipantMedia(state.me.id ?? '');
  const inCall = myMedia.micActivated;

  const callIds = useMemo(
    () => callParticipantIds(state.me.id, state.participants, activeCallConversationId),
    [activeCallConversationId, state.me.id, state.participants]
  );

  function handleOpenCall(conversationId: string) {
    joinCall(conversationId);
    setActiveView('call');
    setMobileShowSidebar(false);
    if (!isConversationsPath(window.location.pathname)) navigate(ROUTES.conversation(conversationId));
  }

  // The call stage only ever shows on the conversations page. Elsewhere the
  // call keeps running (audio, PiP) — navigating never ends it.
  const showStage = onConversations && activeView === 'call' && !!activeCallConversationId && inCall;

  const activeConversation = conversations.find((conversation) => conversation.id === activeConversationId);
  const activeConversationName = conversationTitle(activeConversation, state.me.userId, allUsers);

  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (publishing) { e.preventDefault(); e.returnValue = ''; }
    }
    function onPageHide() {
      sendWs({ t: 'leave' });
      livekitRoom.disconnect();
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      if (closeTileMenu()) return;
      if (state.focusedId) dispatch({ type: 'SET_FOCUSED', id: null });
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [publishing, livekitRoom, closeTileMenu, state.focusedId, dispatch, sendWs]);

  if (state.clientOutdated) return <OutdatedClientScreen />;
  if (roomError) return <RoomErrorScreen message={roomError} />;
  if (!state.joined) return <LoadingScreen />;

  return (
    <GlobalContextMenu onOpenProfile={setProfileUserId}>
      <AnimatedSidebarProvider
        open={sidebarOpen}
        onOpenChange={setSidebarOpen}
        openMobile={mobileShowSidebar}
        onOpenMobileChange={setMobileShowSidebar}
        className="h-dvh bg-bg-primary text-text-primary"
        style={{ '--sidebar-width': '22rem', '--sidebar-width-icon': '4.5rem' }}
      >
        <ReconnectBanner />
        <AccessNotice />
        <ConversationSidebar
          onOpenSettings={() => navigate(ROUTES.settings)}
          onOpenProfile={setProfileUserId}
          onOpenPalette={() => setPaletteOpen(true)}
        />
        <AnimatedSidebarInset className="relative min-h-0 overflow-hidden bg-[rgb(10_10_12)] md:my-2 md:mr-2 md:ml-2 md:rounded-2xl md:border md:border-white/10">
          <Routes>
            <Route
              path="/app/conversations/:conversationId?"
              element={showStage ? (
                <Stage allIds={callIds} />
              ) : (
                <ConversationPanel
                  onOpenProfile={setProfileUserId}
                  onOpenCall={handleOpenCall}
                  onOpenSearch={() => setSearchOpen(true)}
                  onOpenDetails={() => { setMediaOpen(false); setDetailsOpen(true); }}
                  onOpenMedia={() => { setDetailsOpen(false); setMediaOpen(true); }}
                />
              )}
            />
            <Route path={ROUTES.friends} element={<FriendsPage onOpenProfile={setProfileUserId} />} />
            <Route path={ROUTES.requests} element={<RequestsRedirect />} />
            <Route path="/admin/*" element={<Suspense fallback={<p className="p-6 text-label text-text-muted">Carregando…</p>}><AdminArea /></Suspense>} />
            <Route path="/app/settings/:tab?" element={<SettingsPage onOpenProfile={setProfileUserId} />} />
            <Route path="*" element={<Navigate to={ROUTES.conversations} replace />} />
          </Routes>
          {showStage && (
            <>
              <CallControlBar />
              <CallChatToggleButton chatOpen={callChatOpen} onToggleChat={() => setCallChatOpen((v) => !v)} />
            </>
          )}
          {inCall && <ParticipantAudioLayer participantIds={callIds} />}
          {inCall && !showStage && (
            <FloatingPip
              allIds={callIds}
              onExpand={() => {
                setActiveView('call');
                if (!onConversations) navigate(activeCallConversationId ? ROUTES.conversation(activeCallConversationId) : ROUTES.conversations);
              }}
            />
          )}
          <ReactionsOverlay />
        </AnimatedSidebarInset>
        <GroupDetailsPanel
          conversationId={activeConversation?.type === 'group' ? activeConversation.id : null}
          open={detailsOpen && onConversations && activeConversation?.type === 'group' && activeView !== 'call'}
          onOpenChange={setDetailsOpen}
          onOpenProfile={setProfileUserId}
        />
        <ConversationMediaPanel
          conversationId={activeConversation?.id ?? null}
          open={mediaOpen && onConversations && !!activeConversation && activeView !== 'call'}
          onOpenChange={setMediaOpen}
        />
        <CallChatPanel
          conversationId={activeCallConversationId}
          open={callChatOpen && showStage}
          onOpenChange={setCallChatOpen}
          onOpenProfile={setProfileUserId}
        />
        <TileMenu />
        <ProfileModal userId={profileUserId} onClose={() => setProfileUserId(null)} />
        <CommandPaletteMount
          open={paletteOpen}
          onOpenChange={setPaletteOpen}
          onCall={handleOpenCall}
          onMobileNavigated={() => setMobileShowSidebar(false)}
        />
        <ChatSearchDialog
          open={searchOpen}
          onOpenChange={setSearchOpen}
          activeConversationId={activeConversationId}
          activeConversationName={activeConversationName}
        />
      </AnimatedSidebarProvider>
    </GlobalContextMenu>
  );
}

/** Split out from Shell only because it needs `useAnimatedSidebar()` (for
 * `isMobile`, to close the mobile sidebar sheet after a palette selection,
 * same as ConversationSidebar's own row clicks) — a hook that only works
 * inside the AnimatedSidebarProvider Shell itself renders, so Shell (the
 * provider's parent, not a descendant of it) can't call it directly. */
function CommandPaletteMount({ open, onOpenChange, onCall, onMobileNavigated }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCall: (conversationId: string) => void;
  onMobileNavigated: () => void;
}) {
  const { state, conversations, allUsers, activeCallConversationId, openConversation, openDirect, requestChatView } = useRoom();
  const { isMobile } = useAnimatedSidebar();
  const navigate = useNavigate();

  const commandItems = useMemo(() => buildCommandItems(
    conversations, allUsers, state.me.userId, state.participants, activeCallConversationId,
    {
      onOpenConversation: (id) => {
        openConversation(id);
        navigate(ROUTES.conversation(id));
        requestChatView();
        if (isMobile) onMobileNavigated();
      },
      onMessageUser: (userId) => {
        openDirect(userId);
        requestChatView();
        if (isMobile) onMobileNavigated();
      },
      onCall: (id) => {
        openConversation(id);
        onCall(id);
      },
    }
  ), [conversations, allUsers, state.me.userId, state.participants, activeCallConversationId, isMobile, openConversation, openDirect, requestChatView, onCall, onMobileNavigated, navigate]);

  return (
    <CommandPalette
      items={commandItems}
      open={open}
      onOpenChange={onOpenChange}
      placeholder="Buscar conversas ou uma ação…"
      emptyMessage="Nada encontrado."
    />
  );
}

function AuthGate() {
  const { status, user } = useAuth();
  if (status === 'loading') return <LoadingScreen />;
  if (status === 'anon' || !user) return <AuthScreen />;
  if (!user.email) return <EmailRequiredModal />;
  return (
    <RoomProvider key={user.id}>
      <FriendsProvider>
        <Shell />
      </FriendsProvider>
    </RoomProvider>
  );
}

export function App() {
  return (
    // The router sits ABOVE the auth gate but only its <Routes> (inside Shell)
    // ever swap — RoomProvider, and with it the LiveKit call, never remounts
    // on navigation.
    <BrowserRouter>
      <AuthProvider>
        <TooltipProvider>
          <AuthGate />
        </TooltipProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

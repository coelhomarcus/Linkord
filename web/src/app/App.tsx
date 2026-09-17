import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RoomProvider } from '@/app/providers/RoomProvider';
import { useRoom } from '@/state/RoomContext';
import { AuthProvider, useAuth } from '@/state/AuthContext';
import { AuthScreen } from '@/features/auth/AuthScreen';
import { EmailRequiredModal } from '@/features/auth/EmailRequiredModal';
import { RoomErrorScreen } from '@/app/layout/RoomErrorScreen';
import { LoadingScreen } from '@/app/layout/LoadingScreen';
import { ReconnectBanner } from '@/app/layout/ReconnectBanner';
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
import { AnimatedSidebarInset, AnimatedSidebarProvider, useAnimatedSidebar } from '@/shared/ui/motion/animated-sidebar';
import { CommandPalette } from '@/shared/ui/motion/command-palette';
import { buildCommandItems } from '@/features/conversations/commandPaletteItems';
import { loadSidebarCollapsed, saveSidebarCollapsed } from '@/shared/hooks/useSidebarCollapsedPreference';
import { TooltipProvider } from '@/shared/ui/primitives/tooltip';

const SettingsModal = lazy(() => import('@/features/settings/SettingsModal').then((m) => ({ default: m.SettingsModal })));

function Shell() {
  const {
    state, dispatch, livekitRoom, closeTileMenu, sendWs, notifyActiveView, registerRequestChatView,
    activeCallConversationId, activeConversationId, joinCall, conversations, allUsers,
  } = useRoom();
  const [activeView, setActiveView] = useState<'chat' | 'call'>('chat');
  const roomError = state.roomError;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [profileUserId, setProfileUserId] = useState<string | null>(null);
  const [mobileShowSidebar, setMobileShowSidebar] = useState(true);
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

  useEffect(() => { registerRequestChatView(() => setActiveView('chat')); }, [registerRequestChatView]);

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
  }

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
        <ConversationSidebar
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenProfile={setProfileUserId}
          onOpenPalette={() => setPaletteOpen(true)}
        />
        <AnimatedSidebarInset className="relative min-h-0 overflow-hidden bg-[rgb(10_10_12)] md:my-2 md:mr-2 md:ml-2 md:rounded-2xl md:border md:border-white/10">
          {activeView === 'call' && activeCallConversationId && inCall ? (
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
          {activeView === 'call' && inCall && (
            <>
              <CallControlBar />
              <CallChatToggleButton chatOpen={callChatOpen} onToggleChat={() => setCallChatOpen((v) => !v)} />
            </>
          )}
          {inCall && <ParticipantAudioLayer participantIds={callIds} />}
          {inCall && activeView !== 'call' && <FloatingPip allIds={callIds} onExpand={() => setActiveView('call')} />}
          <ReactionsOverlay />
        </AnimatedSidebarInset>
        <GroupDetailsPanel
          conversationId={activeConversation?.type === 'group' ? activeConversation.id : null}
          open={detailsOpen && activeConversation?.type === 'group' && activeView !== 'call'}
          onOpenChange={setDetailsOpen}
          onOpenProfile={setProfileUserId}
        />
        <ConversationMediaPanel
          conversationId={activeConversation?.id ?? null}
          open={mediaOpen && !!activeConversation && activeView !== 'call'}
          onOpenChange={setMediaOpen}
        />
        <CallChatPanel
          conversationId={activeCallConversationId}
          open={callChatOpen && activeView === 'call' && inCall}
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
        <Suspense fallback={null}>
          <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
        </Suspense>
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

  const commandItems = useMemo(() => buildCommandItems(
    conversations, allUsers, state.me.userId, state.participants, activeCallConversationId,
    {
      onOpenConversation: (id) => {
        openConversation(id);
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
  ), [conversations, allUsers, state.me.userId, state.participants, activeCallConversationId, isMobile, openConversation, openDirect, requestChatView, onCall, onMobileNavigated]);

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
      <Shell />
    </RoomProvider>
  );
}

export function App() {
  return (
    <AuthProvider>
      <TooltipProvider>
        <AuthGate />
      </TooltipProvider>
    </AuthProvider>
  );
}

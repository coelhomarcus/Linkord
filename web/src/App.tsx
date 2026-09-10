import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { RoomProvider } from './state/RoomProvider';
import { useRoom } from './state/RoomContext';
import { AuthProvider, useAuth } from './state/AuthContext';
import { AuthScreen } from './features/auth/AuthScreen';
import { RoomErrorScreen } from './features/room/RoomErrorScreen';
import { LoadingScreen } from './features/room/LoadingScreen';
import { ReconnectBanner } from './shared/ReconnectBanner';
import { ConversationSidebar } from './features/conversations/ConversationSidebar';
import { ConversationPanel } from './features/conversations/ConversationPanel';
import { ChatSearchDialog } from './features/chat/ChatSearchDialog';
import { Stage } from './features/sharing/Stage';
import { CallControlBar } from './features/sharing/CallControlBar';
import { ParticipantAudioLayer } from './features/sharing/ParticipantAudioLayer';
import { FloatingPip } from './features/sharing/FloatingPip';
import { useParticipantMedia } from './features/sharing/useLiveKitTrack';
import { callParticipantIds, conversationTitle } from './features/conversations/conversationUtils';
import { TileMenu } from './features/sharing/TileMenu';
import { ReactionsOverlay } from './features/reactions/ReactionsOverlay';
import { GlobalContextMenu } from './components/GlobalContextMenu';
import { ProfileModal } from './features/profile/ProfileModal';
import { TooltipProvider } from '@/components/ui/tooltip';
import { cn } from '@/shared/lib/utils';

const SettingsModal = lazy(() => import('./features/settings/SettingsModal').then((m) => ({ default: m.SettingsModal })));

function Shell() {
  const {
    state, dispatch, livekitRoom, closeTileMenu, sendWs, notifyActiveView, registerRequestChatView,
    activeCallConversationId, activeConversationId, joinGroupCall, conversations, allUsers,
  } = useRoom();
  const [activeView, setActiveView] = useState<'chat' | 'call'>('chat');
  const roomError = state.roomError;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [profileUserId, setProfileUserId] = useState<string | null>(null);
  const [mobileShowSidebar, setMobileShowSidebar] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => { notifyActiveView(activeView); }, [activeView, notifyActiveView]);

  useEffect(() => { registerRequestChatView(() => setActiveView('chat')); }, [registerRequestChatView]);

  const publishing = state.me.sharing || state.me.cameraOn;

  const myMedia = useParticipantMedia(state.me.id ?? '');
  const inCall = myMedia.micActivated;

  const callIds = useMemo(
    () => callParticipantIds(state.me.id, state.participants, activeCallConversationId),
    [activeCallConversationId, state.me.id, state.participants]
  );

  function handleSelectMobile() {
    setMobileShowSidebar(false);
  }

  function handleOpenCall(conversationId: string) {
    joinGroupCall(conversationId);
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
    <GlobalContextMenu>
      <div className="flex h-dvh overflow-hidden bg-bg-primary text-text-primary">
        <ReconnectBanner />
        <ConversationSidebar
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenProfile={setProfileUserId}
          mobileVisible={mobileShowSidebar}
          onSelect={handleSelectMobile}
        />
        <div className={cn('relative min-h-0 flex-1 md:flex', mobileShowSidebar ? 'hidden' : 'flex')}>
          {activeView === 'call' && activeCallConversationId && inCall ? (
            <Stage allIds={callIds} onBackMobile={() => setMobileShowSidebar(true)} />
          ) : (
            <ConversationPanel
              mobileListVisible={mobileShowSidebar}
              onBackMobile={() => setMobileShowSidebar(true)}
              onOpenProfile={setProfileUserId}
              onOpenCall={handleOpenCall}
              onOpenSearch={() => setSearchOpen(true)}
            />
          )}
          {activeView === 'call' && inCall && <CallControlBar />}
          {inCall && <ParticipantAudioLayer participantIds={callIds} />}
          {inCall && activeView !== 'call' && <FloatingPip allIds={callIds} />}
          <ReactionsOverlay />
        </div>
        <TileMenu />
        <ProfileModal userId={profileUserId} onClose={() => setProfileUserId(null)} />
        <Suspense fallback={null}>
          <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
        </Suspense>
        <ChatSearchDialog
          open={searchOpen}
          onOpenChange={setSearchOpen}
          activeConversationId={activeConversationId}
          activeConversationName={activeConversationName}
        />
      </div>
    </GlobalContextMenu>
  );
}

function AuthGate() {
  const { status, user } = useAuth();
  if (status === 'loading') return <LoadingScreen />;
  if (status === 'anon' || !user) return <AuthScreen />;
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

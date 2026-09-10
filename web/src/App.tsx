import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { RoomProvider } from './state/RoomProvider';
import { useRoom } from './state/RoomContext';
import { AuthProvider, useAuth } from './state/AuthContext';
import { AuthScreen } from './features/auth/AuthScreen';
import { RoomErrorScreen } from './features/room/RoomErrorScreen';
import { LoadingScreen } from './features/room/LoadingScreen';
import { ReconnectBanner } from './shared/ReconnectBanner';
import { LeftSidebar } from './components/LeftSidebar';
import type { AppView } from './components/LeftSidebar';
import { ChatPage } from './features/chat/ChatPage';
import { Stage } from './features/sharing/Stage';
import { VoiceIdleScreen } from './features/sharing/VoiceIdleScreen';
import { CallControlBar } from './features/sharing/CallControlBar';
import { ParticipantAudioLayer } from './features/sharing/ParticipantAudioLayer';
import { FloatingPip } from './features/sharing/FloatingPip';
import { useParticipantMedia } from './features/sharing/useLiveKitTrack';
import { TileMenu } from './features/sharing/TileMenu';
import { ReactionsOverlay } from './features/reactions/ReactionsOverlay';
import { GlobalContextMenu } from './components/GlobalContextMenu';
import { ProfileModal } from './features/profile/ProfileModal';
import { TooltipProvider } from '@/components/ui/tooltip';
import { cn } from '@/shared/lib/utils';

const SettingsModal = lazy(() => import('./features/settings/SettingsModal').then((m) => ({ default: m.SettingsModal })));

function Shell() {
  const { state, dispatch, livekitRoom, closeTileMenu, sendWs, notifyActiveView, registerRequestChatView, activeVoiceChannelId } = useRoom();
  const [activeView, setActiveView] = useState<AppView>('chat');
  const [viewedVoiceChannelId, setViewedVoiceChannelId] = useState<string | null>(null);
  const roomError = state.roomError;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [profileUserId, setProfileUserId] = useState<string | null>(null);
  const [mobileShowSidebar, setMobileShowSidebar] = useState(true);

  useEffect(() => { notifyActiveView(activeView); }, [activeView, notifyActiveView]);

  useEffect(() => { registerRequestChatView(() => setActiveView('chat')); }, [registerRequestChatView]);

  const publishing = state.me.sharing || state.me.cameraOn;

  const viewingLiveChannel = !!viewedVoiceChannelId && viewedVoiceChannelId === activeVoiceChannelId;

  const myMedia = useParticipantMedia(state.me.id ?? '');
  const inCall = myMedia.micActivated;

  const allIds = useMemo(() => {
    const ids: string[] = [];
    if (state.me.id) ids.push(state.me.id);
    for (const p of state.participants.values()) ids.push(p.id);
    return ids;
  }, [state.participants, state.me.id]);

  function handleViewChange(next: AppView, voiceChannelId?: string) {
    setActiveView(next);
    if (next === 'call' && voiceChannelId) setViewedVoiceChannelId(voiceChannelId);
  }

  function handleSelectChannelMobile() {
    setMobileShowSidebar(false);
  }

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
        <LeftSidebar
          activeView={activeView}
          onViewChange={handleViewChange}
          inCall={inCall}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenProfile={setProfileUserId}
          mobileVisible={mobileShowSidebar}
          onSelectChannelMobile={handleSelectChannelMobile}
        />
        <div className={cn('relative min-h-0 flex-1 md:flex', mobileShowSidebar ? 'hidden' : 'flex')}>
          {activeView === 'chat' && <ChatPage onBackMobile={() => setMobileShowSidebar(true)} onOpenProfile={setProfileUserId} />}
          {activeView === 'call' && viewedVoiceChannelId && (
            viewingLiveChannel
              ? <Stage allIds={allIds} onBackMobile={() => setMobileShowSidebar(true)} />
              : (
                <VoiceIdleScreen
                  channelId={viewedVoiceChannelId}
                  onBackMobile={() => setMobileShowSidebar(true)}
                  onOpenChat={() => setActiveView('chat')}
                />
              )
          )}
          {activeView === 'call' && inCall && <CallControlBar />}
          {inCall && <ParticipantAudioLayer participantIds={allIds} />}
          {inCall && activeView !== 'call' && <FloatingPip allIds={allIds} />}
          <ReactionsOverlay />
        </div>
        <TileMenu />
        <ProfileModal userId={profileUserId} onClose={() => setProfileUserId(null)} />
        <Suspense fallback={null}>
          <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
        </Suspense>
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

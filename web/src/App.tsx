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
import { CallControlBar } from './features/sharing/CallControlBar';
import { ParticipantAudioLayer } from './features/sharing/ParticipantAudioLayer';
import { FloatingPip } from './features/sharing/FloatingPip';
import { useParticipantMedia } from './features/sharing/useLiveKitTrack';
import { TileMenu } from './features/sharing/TileMenu';
import { ReactionsOverlay } from './features/reactions/ReactionsOverlay';
import { GlobalContextMenu } from './components/GlobalContextMenu';
import { TooltipProvider } from '@/components/ui/tooltip';
import { cn } from '@/shared/lib/utils';

// lazy: SettingsModal pulls in MediaTab/ModerationTab (which in turn pull
// LinkPreview/GenericEmbed/react-player) — a lot of weight for something
// most sessions never open. Kept out of the initial bundle, downloads in
// parallel without blocking first paint.
const SettingsModal = lazy(() => import('./features/settings/SettingsModal').then((m) => ({ default: m.SettingsModal })));

function Shell() {
  const { state, dispatch, livekitRoom, closeTileMenu, sendWs, notifyActiveView } = useRoom();
  const [activeView, setActiveView] = useState<AppView>('chat');
  const roomError = state.roomError;
  const [settingsOpen, setSettingsOpen] = useState(false);
  // mobile-only: below md there's no room for sidebar + content side by
  // side, so they become two panels shown one at a time (see LeftSidebar's
  // and the content wrapper's `md:flex` below, which ignores this and
  // always shows both from md up).
  const [mobileShowSidebar, setMobileShowSidebar] = useState(true);

  // only so the new-message sound (RoomProvider) knows if the person is
  // already looking at chat.
  useEffect(() => { notifyActiveView(activeView); }, [activeView, notifyActiveView]);

  // mic isn't included: with the "native" model (activate once, only
  // mute/unmute), it stays published in the background for most of the
  // session — including it would fire the warning uselessly. Screen/camera
  // are still things that really "stop" if the tab closes unintentionally.
  const publishing = state.me.sharing || state.me.cameraOn;

  // "am I in the call" = my mic was activated this session — LiveKit
  // (micActivated) is already the source of truth, like the rest of the app.
  const myMedia = useParticipantMedia(state.me.id ?? '');
  const inCall = myMedia.micActivated;

  // everyone in the room (me + participants) — passed down to whoever
  // filters who's actually in the call (useCallTiles already only makes a
  // tile for a published mic; ParticipantAudioLayer only mounts once I'm
  // in the call, see below).
  const allIds = useMemo(() => {
    const ids: string[] = [];
    if (state.me.id) ids.push(state.me.id);
    for (const p of state.participants.values()) ids.push(p.id);
    return ids;
  }, [state.participants, state.me.id]);

  // only switches the visible tab — actually joining a voice channel
  // (connecting the Room, activating the mic) is triggered by
  // joinVoiceChannel, called when clicking the specific channel in the
  // sidebar (LeftSidebar.tsx#handleSelectChannel), not here anymore just
  // by switching tabs.
  function handleViewChange(next: AppView) {
    setActiveView(next);
  }

  // picking a channel on mobile should show its content right away, not
  // leave the person staring at the sidebar they just tapped in.
  function handleSelectChannelMobile() {
    setMobileShowSidebar(false);
  }

  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (publishing) { e.preventDefault(); e.returnValue = ''; }
    }
    function onPageHide() {
      // leaves the room immediately instead of waiting for the server's
      // reconnect window (that should only apply to network drops, not a
      // tab actually closing/reloading) — disconnecting the LiveKit Room
      // already stops camera/mic/screen at once.
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

  // room-level error (e.g. room full) — the socket was already
  // deliberately disconnected at this point (see RoomProvider), so there's
  // no normal UI to show behind it. After all hooks, on purpose (rules of hooks).
  if (roomError) return <RoomErrorScreen message={roomError} />;
  // socket connected but welcome hasn't arrived yet — without this the UI
  // would appear "assembling" empty (sidebar with no channels, chat with
  // no history) for an instant until the data arrives.
  if (!state.joined) return <LoadingScreen />;

  return (
    <GlobalContextMenu onOpenSettings={() => setSettingsOpen(true)}>
      <div className="flex h-dvh overflow-hidden bg-bg-primary text-text-primary">
        <ReconnectBanner />
        <LeftSidebar
          activeView={activeView}
          onViewChange={handleViewChange}
          inCall={inCall}
          onOpenSettings={() => setSettingsOpen(true)}
          mobileVisible={mobileShowSidebar}
          onSelectChannelMobile={handleSelectChannelMobile}
        />
        <div className={cn('relative min-h-0 flex-1 md:flex', mobileShowSidebar ? 'hidden' : 'flex')}>
          {activeView === 'chat' && <ChatPage onBackMobile={() => setMobileShowSidebar(true)} />}
          {activeView === 'call' && <Stage allIds={allIds} onBackMobile={() => setMobileShowSidebar(true)} />}
          {/* full floating bar (mic/camera/screen/reactions) only on the
              Call tab itself — elsewhere the LeftSidebar's compact panel
              covers it. */}
          {activeView === 'call' && inCall && <CallControlBar />}
          {/* only hears others if I'm in the call myself — like Discord,
              seeing/knowing who's connected (LeftSidebar) isn't the same
              as hearing their audio. */}
          {inCall && <ParticipantAudioLayer participantIds={allIds} />}
          {inCall && activeView !== 'call' && <FloatingPip allIds={allIds} />}
          <ReactionsOverlay />
        </div>
        <TileMenu />
        <Suspense fallback={null}>
          <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
        </Suspense>
      </div>
    </GlobalContextMenu>
  );
}

/** Decides between the login screen and the real app. RoomProvider (which
 * opens the socket) only mounts once `status === 'authed'` — no anonymous
 * socket should ever exist (the server would reject it anyway via
 * io.use), but it doesn't even try. `key={user.id}` forces a NEW
 * RoomProvider if the logged-in account changes (e.g. logout then login as
 * someone else in the same tab), instead of an old one surviving with
 * someone else's state. */
function AuthGate() {
  const { status, user } = useAuth();
  if (status === 'loading') return <LoadingScreen />; // avoids flashing the login screen before knowing if a session already exists
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

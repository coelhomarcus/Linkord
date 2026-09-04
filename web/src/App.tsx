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

// lazy: SettingsModal carrega MediaTab/ModerationTab (que por sua vez
// puxam LinkPreview/GenericEmbed/react-player) junto — bastante peso pra
// algo que a maioria das sessoes nunca abre. Fica fora do bundle inicial e
// so baixa em paralelo, sem travar o primeiro paint.
const SettingsModal = lazy(() => import('./features/settings/SettingsModal').then((m) => ({ default: m.SettingsModal })));

function Shell() {
  const { state, dispatch, livekitRoom, closeTileMenu, sendWs, activateMic, notifyActiveView } = useRoom();
  const [activeView, setActiveView] = useState<AppView>('chat');
  const roomError = state.roomError;
  const [settingsOpen, setSettingsOpen] = useState(false);

  // so pro som de mensagem nova (RoomProvider) saber se a pessoa ja esta
  // olhando o chat agora — ver notifyActiveView.
  useEffect(() => { notifyActiveView(activeView); }, [activeView, notifyActiveView]);

  // mic nao entra aqui: com o modelo "nativo" (ativa uma vez, so muta/
  // desmuta), ele fica publicado em segundo plano quase a sessao toda —
  // incluir ele faria o aviso disparar sempre, sem ser util. Tela/camera
  // continuam sendo coisas que realmente "param" se a aba fechar sem querer.
  const publishing = state.me.sharing || state.me.cameraOn;

  // "estou na chamada" = ja ativei meu mic nesta sessao — sem estado novo,
  // LiveKit (micActivated) ja e a fonte de verdade, igual o resto do app.
  const myMedia = useParticipantMedia(state.me.id ?? '');
  const inCall = myMedia.micActivated;

  // lista de quem esta na sala (eu + participantes) — repassada pra quem
  // filtra sozinho quem de fato esta na call (useCallTiles ja so gera tile
  // pra quem tem mic publicado; ParticipantAudioLayer so monta quando eu
  // mesma estou na call, ver abaixo).
  const allIds = useMemo(() => {
    const ids: string[] = [];
    if (state.me.id) ids.push(state.me.id);
    for (const p of state.participants.values()) ids.push(p.id);
    return ids;
  }, [state.participants, state.me.id]);

  // clicar em "Chamada" pela primeira vez e o que "entra" na call agora —
  // antes disso o mic nunca ativa sozinho.
  function handleViewChange(next: AppView) {
    if (next === 'call' && !inCall) activateMic();
    setActiveView(next);
  }

  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (publishing) { e.preventDefault(); e.returnValue = ''; }
    }
    function onPageHide() {
      // sai da sala na hora em vez de esperar a janela de reconexao do
      // servidor (essa so deveria valer pra queda de rede, nao pra aba
      // fechando/recarregando de verdade) — desconectar a Room do LiveKit
      // ja para camera/mic/tela de uma vez.
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

  // erro em nivel de sala (ex.: sala cheia) — o socket ja foi desconectado
  // de proposito nesse ponto (ver RoomProvider), entao nao ha UI normal pra
  // mostrar por tras. Depois de todos os hooks, de proposito (rules of hooks).
  if (roomError) return <RoomErrorScreen message={roomError} />;
  // socket conectado mas welcome ainda nao chegou — sem isso a UI aparecia
  // "montando" vazia (sidebar sem canais, chat sem historico) por um
  // instante ate os dados chegarem.
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
        />
        <div className="relative flex min-h-0 flex-1">
          {activeView === 'chat' && <ChatPage />}
          {activeView === 'call' && <Stage allIds={allIds} />}
          {/* barra flutuante completa (mic/camera/tela/reacoes) so na propria
              tela de Chamada — nas outras, quem cobre isso e o painel de
              conexao compacto da LeftSidebar. */}
          {activeView === 'call' && inCall && <CallControlBar />}
          {/* so ouve os outros se eu mesma estiver na call — igual o
              Discord, ver/estar sabendo quem esta conectado (LeftSidebar)
              nao e o mesmo que estar ouvindo o audio deles. */}
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

/** Decide entre a tela de login e o app de verdade. RoomProvider (que abre o
 * socket) so monta quando `status === 'authed'` — nunca deve existir socket
 * anonimo, o servidor rejeitaria mesmo (io.use), mas nem chega a tentar.
 * `key={user.id}` forca um RoomProvider NOVO se a conta logada trocar (ex.:
 * logout seguido de login com outra conta na mesma aba), em vez de um
 * antigo sobreviver com estado de outra pessoa. */
function AuthGate() {
  const { status, user } = useAuth();
  if (status === 'loading') return <LoadingScreen />; // evita piscar a tela de login antes de saber se ja ha sessao
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

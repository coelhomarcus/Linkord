import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import { Room, RoomEvent, Track } from 'livekit-client';
import type { LocalTrackPublication } from 'livekit-client';
import { RoomContext } from './RoomContext';
import type { AnchorRect, AudioHandle, ReactionEvent, TileDomHandle } from './RoomContext';
import { roomReducer, initialRoomState } from './roomReducer';
import { useAuth } from './AuthContext';
import { loadIdentity, saveIdentity } from './useIdentitySession';
import { useScreenShare } from '../features/sharing/useScreenShare';
import { useCamera } from '../features/sharing/useCamera';
import { useMicrophone } from '../features/sharing/useMicrophone';
import type { TileKind } from '../features/sharing/tileTypes';
import { loadShowStats, saveShowStats, loadNotifyVolume, saveNotifyVolume } from '../features/settings/useSettingsPreference';
import { playSound, preloadSounds, setVolume } from '../shared/sounds';
import { uploadWithProgress } from '../shared/lib/uploadWithProgress';
import { uploadFileInChunks } from '../shared/lib/chunkedUpload';
import type { Category, ChatMessage, ClientMessage, Participant, PublicUser, ReactionEmoji, ServerMessage, StorageUsage } from '../types/protocol';

const REACTION_DURATION_MS = 3000; // tem que bater com --animate-float-up (index.css)
// so pra nao crescer sem limite numa sessao muito longa — o servidor ja
// limita o historico enviado no welcome, isso aqui e so o lado do cliente
const CHAT_CLIENT_LIMIT = 300;

/** Atualiza o diretorio de usuarios (allUsers) com o avatar/role atuais de
 * um Participant — sem isso, trocar de avatar so aparecia pros outros na
 * sidebar direita depois de recarregar a pagina (allUsers so vinha fresco
 * no `welcome`; participant-updated/joined atualizavam so `state.participants`,
 * a lista de quem esta NA SALA, nao o diretorio de TODOS os cadastrados). */
function mergeUserFromParticipant(prev: Map<string, PublicUser>, participant: Participant): Map<string, PublicUser> {
  const existing = prev.get(participant.userId);
  if (!existing || (existing.avatar === participant.avatar && existing.role === participant.role)) return prev;
  const next = new Map(prev);
  next.set(participant.userId, { ...existing, avatar: participant.avatar, role: participant.role });
  return next;
}

export function RoomProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(roomReducer, initialRoomState);
  const auth = useAuth();

  const socketRef = useRef<Socket | null>(null);
  const myIdRef = useRef<string | null>(null);
  const myUserIdRef = useRef<string | null>(null);
  const tokenRef = useRef<string | null>(null);
  const intentionalCloseRef = useRef(false);
  const tileDomRegistry = useRef<Map<string, TileDomHandle>>(new Map());
  const audioRegistry = useRef<Map<string, AudioHandle>>(new Map());

  // autoplay de audio com som e bloqueado por padrao pelo navegador ate um
  // gesto do usuario — um unico gesto qualquer (clique, tecla) libera pra
  // pagina inteira, entao um flag global e o bastante (nao precisa de um
  // clique por participante/tela compartilhada). Fica true pro resto da
  // sessao assim que dispara uma vez.
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  useEffect(() => {
    if (audioUnlocked) return;
    const unlock = () => setAudioUnlocked(true);
    document.addEventListener('pointerdown', unlock, { once: true });
    document.addEventListener('keydown', unlock, { once: true });
    return () => {
      document.removeEventListener('pointerdown', unlock);
      document.removeEventListener('keydown', unlock);
    };
  }, [audioUnlocked]);

  // "ensurdecer" — para de ouvir todo mundo. `toggleDeafened` de verdade
  // (que tambem muta o mic) so pode ser definido depois de useMicrophone
  // existir mais abaixo — o useState mora aqui perto do resto do audio.
  const [deafened, setDeafened] = useState(false);

  // instancia unica e estavel da Room do LiveKit (camera/tela) — o connect()
  // de fato so acontece quando o primeiro 'welcome' chega com token/url.
  const [livekitRoom] = useState(() => new Room());

  const [showStats, setShowStatsState] = useState(loadShowStats);
  const setShowStats = useCallback((value: boolean) => {
    setShowStatsState(value);
    saveShowStats(value);
  }, []);

  // volume dos efeitos sonoros (0..1) — playSound le isso via modulo
  // (shared/sounds.ts#setVolume), nao por prop/contexto, ja que e chamado
  // de fora de componentes tambem (useMicrophone.ts).
  const [notifyVolume, setNotifyVolumeState] = useState(loadNotifyVolume);
  const setNotifyVolume = useCallback((value: number) => {
    setNotifyVolumeState(value);
    saveNotifyVolume(value);
    setVolume(value);
  }, []);

  const sendWs = useCallback((msg: ClientMessage) => {
    if (socketRef.current?.connected) socketRef.current.emit(msg.t, msg);
  }, []);

  // ---- categorias/canais de chat (admin gerencia) + mensagens por canal —
  // welcome traz a arvore + diretorio de usuarios; conteudo de mensagens e
  // por canal, buscado via channel-open (ver handleServerMessage abaixo).
  // activeChannelIdRef existe pelo MESMO motivo que myIdRef/tokenRef: o
  // handleServerMessage registrado em socket.onAny (dentro de connect(), so
  // chamado uma vez no mount) fecharia sobre o valor de activeChannelId de
  // quando foi criado — sem a ref, uma mensagem chegando pro canal ativo
  // depois de trocar de canal seria julgada "nao ativo" com o valor antigo. --
  const [categories, setCategories] = useState<Category[]>([]);
  const [activeChannelId, setActiveChannelIdState] = useState<string | null>(null);
  const activeChannelIdRef = useRef<string | null>(null);
  // canal de voz em que estou conectada agora (ou null) — mesmo motivo de
  // activeChannelIdRef acima: handleServerMessage e registrado uma unica vez
  // no mount (dentro de connect()), entao precisa ler isso por ref, nao por
  // state fechado. pendingVoiceChannelIdRef existe so pra 'voice-token'
  // conseguir descartar uma resposta atrasada de um voice-join anterior, se
  // a pessoa trocar de canal de voz rapido antes da primeira resposta chegar.
  const [activeVoiceChannelId, setActiveVoiceChannelIdState] = useState<string | null>(null);
  const activeVoiceChannelIdRef = useRef<string | null>(null);
  const pendingVoiceChannelIdRef = useRef<string | null>(null);
  const setActiveVoiceChannelId = useCallback((id: string | null) => {
    activeVoiceChannelIdRef.current = id;
    setActiveVoiceChannelIdState(id);
  }, []);
  // tela ativa (chat/call) — mora em Shell (App.tsx), nao aqui, mas o som de
  // mensagem nova (mais abaixo) precisa saber se a pessoa ja esta OLHANDO o
  // chat pra nao tocar a toa; mesmo motivo/padrao de activeChannelIdRef
  // acima (ref pra nao fechar sobre um valor antigo dentro do
  // handleServerMessage, registrado uma unica vez no mount).
  const activeViewRef = useRef<'chat' | 'call'>('chat');
  const notifyActiveView = useCallback((view: 'chat' | 'call') => { activeViewRef.current = view; }, []);
  const [messagesByChannel, setMessagesByChannel] = useState<Map<string, ChatMessage[]>>(new Map());
  const [unreadByChannel, setUnreadByChannel] = useState<Map<string, number>>(new Map());
  const [allUsers, setAllUsers] = useState<Map<string, PublicUser>>(new Map());
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set());
  const [storageUsage, setStorageUsage] = useState<StorageUsage>({ totalBytes: 0, totalFiles: 0, maxBytes: 0 });
  // erro transiente de gerenciamento de canal (ex.: apagar categoria nao
  // vazia) — separado de `roomError` (esse e bloqueante de tela inteira,
  // isso aqui e recuperavel, o admin so tenta de novo depois de corrigir).
  const [channelsError, setChannelsError] = useState<string | null>(null);
  // mesmo espirito, pra aba Moderacao (apagar conta) — separado de
  // channelsError pra um erro de um nao aparecer encaixado na tela do outro.
  const [moderationError, setModerationError] = useState<string | null>(null);

  /** Troca de canal ativo — zera o nao-lido dele e pede o historico fresco
   * do servidor (sem paginacao por enquanto, sempre as ultimas N). Tambem
   * usado internamente ao entrar na sala (primeiro canal) e quando o canal
   * que eu estava vendo e apagado por baixo de mim. */
  const openChannel = useCallback((channelId: string) => {
    activeChannelIdRef.current = channelId;
    setActiveChannelIdState(channelId);
    setUnreadByChannel((prev) => {
      if (!prev.has(channelId)) return prev;
      const next = new Map(prev);
      next.delete(channelId);
      return next;
    });
    sendWs({ t: 'channel-open', channelId });
  }, [sendWs]);

  const sendChatMessage = useCallback((channelId: string, text: string, replyTo?: number) => {
    const trimmed = text.trim();
    if (trimmed) sendWs({ t: 'chat', channelId, text: trimmed, ...(replyTo ? { replyTo } : {}) });
  }, [sendWs]);
  // moderacao (so admin) — o servidor revalida o role antes de aceitar,
  // isso aqui e so pra nao nem tentar mandar se claramente nao vai colar
  const deleteChatMessage = useCallback((msgId: number) => sendWs({ t: 'chat-delete', msgId }), [sendWs]);
  const editChatMessage = useCallback((msgId: number, text: string) => {
    const trimmed = text.trim();
    if (trimmed) sendWs({ t: 'chat-edit', msgId, text: trimmed });
  }, [sendWs]);
  const reactToChatMessage = useCallback((msgId: number, emoji: ReactionEmoji) => sendWs({ t: 'chat-react', msgId, emoji }), [sendWs]);

  // anexo (imagem/arquivo) — vai por HTTP puro, nao pelo WebSocket (ver
  // server/attachments.js: binario cru e mais simples que inflar em base64
  // pra caber no transporte do Socket.IO), sempre em pedacos (ver
  // chunkedUpload.ts) — teto de 2GB nunca passaria inteiro de um proxy so
  // (Cloudflare/nginx) nem seria seguro bufferizar inteiro em memoria. A
  // mensagem em si so aparece via o broadcast 'chat' de sempre (tratado mais
  // abaixo), igual texto puro — essa funcao so faz o upload (com progresso
  // real) e propaga o erro pra quem chamou mostrar.
  const sendAttachment = useCallback((channelId: string, file: File, caption: string, onProgress?: (fraction: number) => void) => {
    return uploadFileInChunks({ channelId, file, caption, onProgress });
  }, []);

  // gerenciamento de categoria/canal — todos admin-only (servidor revalida).
  const createCategory = useCallback((name: string) => sendWs({ t: 'category-create', name }), [sendWs]);
  const deleteCategory = useCallback((categoryId: string) => sendWs({ t: 'category-delete', categoryId }), [sendWs]);
  const renameCategory = useCallback((categoryId: string, name: string) => sendWs({ t: 'category-rename', categoryId, name }), [sendWs]);
  const createChannel = useCallback((categoryId: string, name: string, type?: 'text' | 'voice') => sendWs({ t: 'channel-create', categoryId, name, type }), [sendWs]);
  const deleteChannel = useCallback((channelId: string) => sendWs({ t: 'channel-delete', channelId }), [sendWs]);
  const renameChannel = useCallback((channelId: string, name: string) => sendWs({ t: 'channel-rename', channelId, name }), [sendWs]);
  const reorderCategories = useCallback((orderedIds: string[]) => sendWs({ t: 'categories-reorder', orderedIds }), [sendWs]);
  const reorderChannels = useCallback((categoryId: string, orderedIds: string[]) => sendWs({ t: 'channels-reorder', categoryId, orderedIds }), [sendWs]);
  const deleteUserAccount = useCallback((userId: string) => sendWs({ t: 'user-delete', userId }), [sendWs]);

  const { startSharing, stopSharing, quality, setQuality } = useScreenShare(livekitRoom, dispatch);
  const { startCamera, stopCamera } = useCamera(livekitRoom, dispatch, quality);
  const { activateMic, toggleMicMuted, setMicMuted, leaveMic } = useMicrophone(livekitRoom, dispatch);

  // ao LIGAR ensurdecer, tambem muta de verdade (se estiver na call) — sem
  // isso, "parar de ouvir todo mundo" deixava o proprio mic ligado, entao
  // continuavam ouvindo VOCE mesmo voce nao ouvindo mais ninguem. Desligar
  // ensurdecer nao desmuta sozinho de volta (decisao deliberada — quem
  // desensurdece decide se tambem quer desmutar, separadamente).
  const toggleDeafened = useCallback(() => {
    // le `deafened` direto (nao a forma de updater do setState) de proposito
    // — precisa do valor novo AQUI FORA pra tocar o som certo uma unica vez;
    // a forma de updater roda de novo no Strict Mode do dev, dobrando o som.
    const next = !deafened;
    setDeafened(next);
    if (next) setMicMuted(true);
    playSound(next ? 'deafened' : 'undeafened');
    // avisa os outros — sem equivalente de track no LiveKit (diferente de
    // mic-mudo), entao precisa de uma mensagem propria pra quem mais poder
    // mostrar o icone (sidebar, tile em foco).
    sendWs({ t: 'deafened', value: next });
  }, [deafened, setMicMuted, sendWs]);

  // "sair do canal de voz" de verdade: para camera/tela (ja desligam o
  // hardware), despublica o mic (leaveMic — diferente de mutar), desconecta
  // da Room do LiveKit desse canal e avisa o servidor. Depois disso `inCall`
  // (App.tsx, = micActivated) volta a false.
  const leaveVoiceChannel = useCallback(async () => {
    if (state.me.cameraOn) stopCamera();
    if (state.me.sharing) stopSharing();
    await leaveMic();
    livekitRoom.disconnect();
    sendWs({ t: 'voice-leave' });
    pendingVoiceChannelIdRef.current = null;
    setActiveVoiceChannelId(null);
  }, [state.me.cameraOn, state.me.sharing, stopCamera, stopSharing, leaveMic, livekitRoom, sendWs, setActiveVoiceChannelId]);

  // entrar de fato num canal de voz especifico — chamado ao clicar num canal
  // de voz na sidebar (LeftSidebar.tsx#handleSelectChannel). Sai do canal
  // atual primeiro se for um diferente (so um canal de voz por vez, igual o
  // Discord); o resto (conectar a Room, ativar o mic) acontece ao receber a
  // resposta 'voice-token', ver handleServerMessage abaixo.
  const joinVoiceChannel = useCallback(async (channelId: string) => {
    if (activeVoiceChannelIdRef.current === channelId) return;
    if (activeVoiceChannelIdRef.current) await leaveVoiceChannel();
    pendingVoiceChannelIdRef.current = channelId;
    sendWs({ t: 'voice-join', channelId });
  }, [sendWs, leaveVoiceChannel]);

  // leaveVoiceChannel muda de identidade toda vez que cameraOn/sharing mudam
  // (le state.me atual) — handleServerMessage abaixo e fechado uma unica vez
  // no mount (mesmo motivo de activeChannelIdRef), entao precisa chamar essa
  // versao SEMPRE ATUAL por ref, senao chamaria uma capturada no mount (com
  // cameraOn/sharing sempre falsos) pro caso de "canal de voz apagado".
  const leaveVoiceChannelRef = useRef(leaveVoiceChannel);
  useEffect(() => { leaveVoiceChannelRef.current = leaveVoiceChannel; }, [leaveVoiceChannel]);

  // desliga camera/tela sozinho quando o usuario para pelo controle nativo
  // do navegador (ex: botao "Parar apresentacao" da barra do Chrome) — o
  // LiveKit ja detecta isso e despublica a track, so falta refletir no
  // reducer. Mic nao precisa disso: "ativado"/"mudo" sao lidos direto do
  // LiveKit (useParticipantMedia), nao ha nada pra sincronizar aqui.
  useEffect(() => {
    const onLocalUnpublished = (pub: LocalTrackPublication) => {
      if (pub.source === Track.Source.ScreenShare) dispatch({ type: 'SET_LOCAL_SHARING', sharing: false });
      if (pub.source === Track.Source.Camera) dispatch({ type: 'SET_LOCAL_CAMERA', on: false });
    };
    livekitRoom.on(RoomEvent.LocalTrackUnpublished, onLocalUnpublished);
    return () => { livekitRoom.off(RoomEvent.LocalTrackUnpublished, onLocalUnpublished); };
  }, [livekitRoom, dispatch]);

  // som de "entrou/saiu da chamada" — mic publicado/despublicado E o
  // criterio de "esta na call" em todo o resto do app (useParticipantMedia).
  // TrackPublished/Unpublished disparam so pra participantes REMOTOS;
  // Local*Published/Unpublished cobrem eu mesma — junto, cobre "todo mundo
  // escuta, ate quem entrou/saiu" sem precisar de nenhum protocolo novo (o
  // proprio LiveKit ja notifica todo cliente conectado). Filtra por
  // Source.Microphone pra nao disparar quando alguem so liga a camera/tela.
  // Compartilhar tela e camera ganham o proprio som (so ao COMECAR, igual
  // foi pedido — parar nao toca nada).
  useEffect(() => {
    const onPublished = (pub: { source: Track.Source }) => {
      if (pub.source === Track.Source.Microphone) playSound('incomingUser');
      if (pub.source === Track.Source.ScreenShare) playSound('screenshare');
      if (pub.source === Track.Source.Camera) playSound('camera');
    };
    // so a MINHA publicacao dispara o webhook do Discord (ver
    // server/discordWebhook.js) — LocalTrackPublished nunca dispara pra
    // participantes remotos, entao nao ha risco de reportar a acao de outra
    // pessoa (o servidor nao tem visibilidade de quem esta na chamada/
    // compartilhando tela, isso vive so no LiveKit).
    const onLocalPublished = (pub: { source: Track.Source }) => {
      onPublished(pub);
      if (pub.source === Track.Source.Microphone) sendWs({ t: 'call-event', kind: 'joined' });
      if (pub.source === Track.Source.ScreenShare) sendWs({ t: 'call-event', kind: 'screenshare' });
    };
    const onMicUnpublished = (pub: { source: Track.Source }) => {
      if (pub.source === Track.Source.Microphone) playSound('userLeave');
    };
    livekitRoom.on(RoomEvent.TrackPublished, onPublished);
    livekitRoom.on(RoomEvent.TrackUnpublished, onMicUnpublished);
    livekitRoom.on(RoomEvent.LocalTrackPublished, onLocalPublished);
    livekitRoom.on(RoomEvent.LocalTrackUnpublished, onMicUnpublished);
    return () => {
      livekitRoom.off(RoomEvent.TrackPublished, onPublished);
      livekitRoom.off(RoomEvent.TrackUnpublished, onMicUnpublished);
      livekitRoom.off(RoomEvent.LocalTrackPublished, onLocalPublished);
      livekitRoom.off(RoomEvent.LocalTrackUnpublished, onMicUnpublished);
    };
  }, [livekitRoom, sendWs]);

  const [reactions, setReactions] = useState<ReactionEvent[]>([]);
  const reactionKeyRef = useRef(0);

  const pushReaction = useCallback((id: string, emoji: ReactionEmoji) => {
    const key = reactionKeyRef.current++;
    const left = 12 + Math.random() * 76; // espalha entre 12% e 88% da largura
    setReactions((prev) => [...prev, { key, id, emoji, left }]);
    setTimeout(() => setReactions((prev) => prev.filter((r) => r.key !== key)), REACTION_DURATION_MS);
  }, []);

  const sendReaction = useCallback((emoji: ReactionEmoji) => {
    sendWs({ t: 'reaction', emoji });
    if (myIdRef.current) pushReaction(myIdRef.current, emoji);
  }, [pushReaction, sendWs]);

  const handleServerMessage = useCallback((m: ServerMessage) => {
    switch (m.t) {
      case 'welcome': {
        myIdRef.current = m.id;
        myUserIdRef.current = m.userId;
        tokenRef.current = m.token;
        saveIdentity(m.id, m.token);
        dispatch({ type: 'WELCOME', id: m.id, userId: m.userId, name: m.name, avatar: m.avatar, role: m.role, participants: m.participants });
        setCategories(m.categories);
        setAllUsers(new Map(m.users.map((u) => [u.id, u])));
        setOnlineUserIds(new Set(m.onlineUserIds));
        setStorageUsage(m.storageUsage);
        {
          // primeiro canal de TEXTO da arvore vira o canal ativo de cara —
          // mesmo padrao do Discord (nunca entra numa sala sem ver um canal
          // de chat). Pula o canal de voz (Chamada) se ele vier antes na
          // arvore — abrir ele nao faz sentido igual abrir um chat.
          const firstChannel = m.categories.flatMap((cat) => cat.channels).find((ch) => ch.type === 'text');
          if (firstChannel) openChannel(firstChannel.id);
        }
        // NAO conecta na Room do LiveKit aqui — so ter a aba aberta/logada
        // nao deve abrir uma sessao de voz de verdade. Isso agora so
        // acontece explicitamente em joinVoiceChannel (clicar num canal de
        // voz), que pede um token novo pra CADA canal (ver 'voice-token').
        break;
      }
      case 'voice-token': {
        // corrida: um segundo voice-join (troca rapida de canal) pode
        // responder depois de outro — so aplica se ainda for o canal que
        // pedimos por ultimo.
        if (m.channelId !== pendingVoiceChannelIdRef.current) break;
        livekitRoom.connect(m.livekitUrl, m.livekitToken)
          .then(() => activateMic())
          .catch((err) => console.warn('LiveKit connect falhou', err));
        setActiveVoiceChannelId(m.channelId);
        break;
      }
      case 'participant-joined':
        dispatch({ type: 'PARTICIPANT_JOINED', participant: m.participant });
        setAllUsers((prev) => mergeUserFromParticipant(prev, m.participant));
        break;
      case 'participant-updated':
        dispatch({ type: 'PARTICIPANT_UPDATED', participant: m.participant });
        setAllUsers((prev) => mergeUserFromParticipant(prev, m.participant));
        break;
      case 'participant-left':
        dispatch({ type: 'PARTICIPANT_LEFT', id: m.id });
        break;
      case 'reaction':
        pushReaction(m.id, m.emoji);
        break;
      case 'channel-history':
        setMessagesByChannel((prev) => new Map(prev).set(m.channelId, m.messages));
        break;
      case 'chat': {
        const channelId = m.message.channelId;
        setMessagesByChannel((prev) => {
          const existing = prev.get(channelId) || [];
          const next = [...existing, m.message];
          return new Map(prev).set(channelId, next.length > CHAT_CLIENT_LIMIT ? next.slice(next.length - CHAT_CLIENT_LIMIT) : next);
        });
        // "numerozinho" de nao lido — so soma se o canal que recebeu NAO e o
        // que estou vendo agora (ref, nao state, ver comentario acima).
        if (channelId !== activeChannelIdRef.current) {
          setUnreadByChannel((prev) => new Map(prev).set(channelId, (prev.get(channelId) || 0) + 1));
        }
        // nunca toca pra mensagem que EU mesma mandei (o broadcast ecoa de
        // volta pro remetente tambem), nem se eu ja estou OLHANDO esse canal
        // agora (aba focada + tela de Chat + esse mesmo canal aberto) — nesse
        // caso a mensagem ja aparece na tela na hora, o som so seria ruido.
        // Fora disso (aba em segundo plano, outra tela do site, ou outro
        // canal) continua tocando, igual o Discord.
        const amLookingAtIt = document.hasFocus() && activeViewRef.current === 'chat' && channelId === activeChannelIdRef.current;
        if (m.message.id !== myUserIdRef.current && !amLookingAtIt) playSound('newMessage');
        break;
      }
      case 'chat-deleted':
        setMessagesByChannel((prev) => {
          const existing = prev.get(m.channelId);
          if (!existing) return prev;
          return new Map(prev).set(m.channelId, existing.filter((msg) => msg.msgId !== m.msgId));
        });
        break;
      case 'chat-edited': {
        const channelId = m.message.channelId;
        setMessagesByChannel((prev) => {
          const existing = prev.get(channelId);
          if (!existing) return prev;
          return new Map(prev).set(channelId, existing.map((msg) => (msg.msgId === m.message.msgId ? m.message : msg)));
        });
        break;
      }
      case 'chat-reaction-updated':
        setMessagesByChannel((prev) => {
          const existing = prev.get(m.channelId);
          if (!existing) return prev;
          const next = existing.map((msg) => {
            if (msg.msgId !== m.msgId) return msg;
            const reactions = { ...msg.reactions };
            if (m.userIds.length) reactions[m.emoji] = m.userIds; else delete reactions[m.emoji];
            return { ...msg, reactions };
          });
          return new Map(prev).set(m.channelId, next);
        });
        break;
      case 'channels-tree': {
        setCategories(m.categories);
        const stillExists = m.categories.some((cat) => cat.channels.some((ch) => ch.id === activeChannelIdRef.current));
        if (!stillExists) {
          const fallback = m.categories.flatMap((cat) => cat.channels).find((ch) => ch.type === 'text');
          if (fallback) openChannel(fallback.id);
          else { activeChannelIdRef.current = null; setActiveChannelIdState(null); }
        }
        break;
      }
      case 'channel-deleted':
        setMessagesByChannel((prev) => {
          if (!prev.has(m.channelId)) return prev;
          const next = new Map(prev);
          next.delete(m.channelId);
          return next;
        });
        setUnreadByChannel((prev) => {
          if (!prev.has(m.channelId)) return prev;
          const next = new Map(prev);
          next.delete(m.channelId);
          return next;
        });
        // canal de voz apagado enquanto eu estava nele — o servidor ja
        // limpou meu voiceChannelId por baixo, so falta eu mesma desconectar
        // da Room/parar mic-camera-tela (senao a UI ficaria "conectada" num
        // canal que nem existe mais).
        if (m.channelId === activeVoiceChannelIdRef.current) leaveVoiceChannelRef.current();
        break;
      case 'user-online':
        setOnlineUserIds((prev) => (prev.has(m.userId) ? prev : new Set(prev).add(m.userId)));
        break;
      case 'user-offline':
        setOnlineUserIds((prev) => {
          if (!prev.has(m.userId)) return prev;
          const next = new Set(prev);
          next.delete(m.userId);
          return next;
        });
        break;
      case 'user-registered':
        setAllUsers((prev) => new Map(prev).set(m.user.id, m.user));
        break;
      case 'user-deleted':
        setAllUsers((prev) => {
          if (!prev.has(m.userId)) return prev;
          const next = new Map(prev);
          next.delete(m.userId);
          return next;
        });
        setOnlineUserIds((prev) => {
          if (!prev.has(m.userId)) return prev;
          const next = new Set(prev);
          next.delete(m.userId);
          return next;
        });
        break;
      case 'storage-usage':
        setStorageUsage({ totalBytes: m.totalBytes, totalFiles: m.totalFiles, maxBytes: m.maxBytes });
        break;
      case 'error':
        if (m.code === 'full') {
          intentionalCloseRef.current = true;
          try { socketRef.current?.disconnect(); } catch { /* ok */ }
          dispatch({ type: 'SET_ROOM_ERROR', message: m.message || 'Sala cheia, tente mais tarde.' });
        } else if (m.code === 'category-not-empty' || m.code === 'cannot-delete-last-voice-channel') {
          setChannelsError(m.message);
        } else if (m.code === 'cannot-delete-self') {
          setModerationError(m.message);
        } else if (m.code === 'livekit-unavailable') {
          pendingVoiceChannelIdRef.current = null;
          dispatch({ type: 'SET_SHARE_ERROR', message: m.message });
        } else {
          // codigo desconhecido — pelo menos aparece no console em vez de
          // falhar em silencio (aconteceu antes com esse mesmo handler).
          console.warn('[ws] erro nao tratado do servidor:', m.code, m.message);
        }
        break;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch, pushReaction, livekitRoom, openChannel, activateMic, setActiveVoiceChannelId]);

  const connect = useCallback(() => {
    intentionalCloseRef.current = false;
    // withCredentials: o handshake (upgrade HTTP) precisa levar o cookie de
    // sessao — io.use no servidor rejeita qualquer conexao sem ele.
    const socket = io(location.origin, { path: '/ws', transports: ['websocket'], withCredentials: true });
    socketRef.current = socket;

    socket.on('connect', () => {
      const saved = loadIdentity();
      sendWs({ t: 'join', id: saved?.id, token: saved?.token });
    });

    socket.onAny((_eventName: string, payload: ServerMessage) => handleServerMessage(payload));

    socket.on('disconnect', () => {
      if (intentionalCloseRef.current) return;
      dispatch({ type: 'SET_RECONNECTING', value: true });
    });

    // rejeicao do io.use (sessao invalida/expirada) — socket.active fica
    // false nesse caso especifico (nao em toda falha de rede), e nunca mais
    // reconecta sozinho. auth.refresh() reconsulta /api/auth/me: se a sessao
    // morreu de verdade, AuthGate cai pra tela de login sozinho.
    socket.on('connect_error', () => {
      if (!socket.active) auth.refresh();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch, sendWs, handleServerMessage, auth]);

  const updateAvatar = useCallback((avatar: string) => {
    const finalAvatar = avatar.trim().slice(0, 500);
    dispatch({ type: 'SET_LOCAL_AVATAR', avatar: finalAvatar });
    sendWs({ t: 'profile', avatar: finalAvatar });
  }, [dispatch, sendWs]);

  // foto de perfil do proprio computador — mesma pasta/rota dos anexos do
  // chat (server/attachments.js), so que a rota devolve so a URL; quem
  // aplica de fato como avatar da conta e o updateAvatar de sempre (mesmo
  // fluxo de quem cola uma URL externa).
  const uploadAvatarFile = useCallback(async (file: File, onProgress?: (fraction: number) => void) => {
    const body = await uploadWithProgress<{ avatar: string }>({
      url: '/api/avatar',
      file,
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      onProgress,
    });
    updateAvatar(body.avatar);
    return body.avatar;
  }, [updateAvatar]);

  // menu de contexto de um tile: key/participante/kind + posicao sao
  // efemeros (nao e estado de sala), guardados fora do reducer. menuOpenRef
  // existe so pra closeTileMenu conseguir responder de forma sincrona se
  // realmente fechou algo (a atualizacao de useState nao e sincrona o
  // bastante pra isso).
  const [menuTarget, setMenuTarget] = useState<{ key: string; participantId: string; kind: TileKind; rect: AnchorRect } | null>(null);
  const menuOpenRef = useRef(false);

  const openTileMenu = useCallback((key: string, participantId: string, kind: TileKind, rect: AnchorRect) => {
    menuOpenRef.current = true;
    setMenuTarget({ key, participantId, kind, rect });
  }, []);
  const closeTileMenu = useCallback(() => {
    if (!menuOpenRef.current) return false;
    menuOpenRef.current = false;
    setMenuTarget(null);
    return true;
  }, []);

  // sobe a conexao uma vez, na montagem — RoomProvider so monta quando ja
  // ha sessao valida (AuthGate em App.tsx), entao nunca precisa decidir "esta
  // logado?" aqui, so conectar.
  useEffect(() => {
    preloadSounds();
    setVolume(notifyVolume);
    connect();
    return () => {
      intentionalCloseRef.current = true;
      socketRef.current?.disconnect();
      livekitRoom.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <RoomContext.Provider
      value={{
        state, dispatch, sendWs, tileDomRegistry, audioRegistry, audioUnlocked, deafened, toggleDeafened, livekitRoom, notifyActiveView,
        activeVoiceChannelId, joinVoiceChannel,
        startSharing, stopSharing, startCamera, stopCamera, activateMic, toggleMicMuted, leaveVoiceChannel, quality, setQuality,
        updateAvatar, uploadAvatarFile, menuTarget, openTileMenu, closeTileMenu,
        reactions, sendReaction, showStats, setShowStats, notifyVolume, setNotifyVolume,
        categories, activeChannelId, openChannel, messagesByChannel, unreadByChannel,
        allUsers, onlineUserIds, channelsError, clearChannelsError: () => setChannelsError(null),
        deleteUserAccount, moderationError, clearModerationError: () => setModerationError(null),
        sendChatMessage, deleteChatMessage, editChatMessage, reactToChatMessage,
        storageUsage, sendAttachment,
        createCategory, deleteCategory, renameCategory, createChannel, deleteChannel, renameChannel, reorderCategories, reorderChannels,
      }}
    >
      {children}
    </RoomContext.Provider>
  );
}

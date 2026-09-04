import { createContext, useContext } from 'react';
import type { Dispatch, MutableRefObject } from 'react';
import type { Room } from 'livekit-client';
import type { Category, ChatMessage, ClientMessage, PublicUser, ReactionEmoji, StorageUsage } from '../types/protocol';
import type { RoomAction, RoomState } from './roomReducer';
import type { Quality } from '../features/settings/useQualityPreference';
import type { TileKind } from '../features/sharing/tileTypes';

/** Uma reacao ativa exibida na camada de overlay — `key` e unico por
 * instancia (nao por participante), ja que a mesma pessoa pode reagir
 * varias vezes seguidas. */
export interface ReactionEvent {
  key: number;
  id: string;
  emoji: ReactionEmoji;
  /** posicao horizontal (% da largura do palco), sorteada uma vez no envio
   * — espalha as reacoes pela tela em vez de empilhar num unico lugar. */
  left: number;
}

/** Registrado por todo tile (o meu e os remotos) — da ao TileMenu acesso ao
 * DOM real (tela cheia mira a raiz, PiP mira o video) sem precisar que o
 * menu seja filho do tile (ele e portalizado direto pro body). Audio NAO
 * mora mais aqui — isso e do ParticipantAudioLayer/audioRegistry abaixo,
 * porque o audio de alguem precisa sobreviver a troca de kind do tile dessa
 * pessoa (ligar/desligar camera), enquanto o tile em si desmonta/remonta. */
export interface TileDomHandle {
  root: HTMLDivElement;
  /** null em tiles sem video (avatar so-audio) — nao ha o que mirar em tela
   * cheia/PiP nesse caso (o TileMenu ja trata isso). */
  video: HTMLVideoElement | null;
}

/** Um elemento de audio compartilhado (mic ou audio de tela de alguem),
 * registrado pelo ParticipantAudioLayer — sobrevive a troca de kind do tile
 * visual dessa pessoa. So pra acesso DOM (volume real do TileMenu); o
 * desbloqueio de autoplay mora em `audioUnlocked` (reativo, ver abaixo), nao
 * aqui — um Map em ref nao re-renderiza o Tile quando muda. Chave:
 * `participantId` pro audio do mic (tile camera/avatar dela),
 * `${participantId}:screen` pro audio da aba compartilhada (tile screen). */
export interface AudioHandle {
  element: HTMLAudioElement;
}

/** Retangulo de ancoragem do menu de contexto — subset de DOMRect, ou os
 * 4 campos equivalentes derivados de um MouseEvent (clique direito). */
export interface AnchorRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface RoomContextValue {
  state: RoomState;
  dispatch: Dispatch<RoomAction>;
  sendWs: (msg: ClientMessage) => void;
  tileDomRegistry: MutableRefObject<Map<string, TileDomHandle>>;
  audioRegistry: MutableRefObject<Map<string, AudioHandle>>;
  /** true assim que a pagina recebe qualquer gesto do usuario (clique,
   * tecla) — autoplay de audio com som e bloqueado por padrao pelo
   * navegador ate isso acontecer. Um flag global (nao por participante):
   * um gesto qualquer ja libera autoplay pra pagina inteira, nao faz
   * sentido pedir um clique por pessoa/tela compartilhada. */
  audioUnlocked: boolean;
  /** "Ensurdecer" — para de OUVIR todo mundo (mic e audio de tela dos
   * outros), sem mexer no meu proprio mic. Puramente local (ninguem mais
   * precisa saber disso, ao contrario de micMuted) — nao passa pelo
   * protocolo. */
  deafened: boolean;
  toggleDeafened: () => void;
  /** Instancia unica da Room do LiveKit (camera/tela) — sempre a mesma
   * referencia durante a vida do RoomProvider; a conexao de fato (connect())
   * so acontece depois do primeiro 'welcome' do Socket.IO. */
  livekitRoom: Room;
  /** Avisa qual tela (chat/call) esta ativa agora — so pro som de mensagem
   * nova saber se a pessoa ja esta olhando o chat (Shell, em App.tsx, chama
   * isso sempre que activeView muda). */
  notifyActiveView: (view: 'chat' | 'call') => void;
  startSharing: () => Promise<void>;
  stopSharing: () => void;
  startCamera: () => Promise<void>;
  stopCamera: () => void;
  /** Pede permissao + publica o mic, ja desmutado — chamado ao clicar em
   * "Chamada" na sidebar (App.tsx), nao mais automatico. Idempotente:
   * seguro chamar de novo (ex: retry apos permissao negada). */
  activateMic: () => Promise<void>;
  /** So alterna mudo/desmutado — assume que activateMic ja rodou. */
  toggleMicMuted: () => Promise<void>;
  /** Sai da chamada de verdade (despublica mic, para camera/tela) — ver
   * useMicrophone.ts. Depois disso, ativar de novo pede o mic de novo. */
  leaveCall: () => Promise<void>;
  quality: Quality;
  setQuality: (q: Quality) => void;
  /** So o avatar e editavel em sessao — nome e o username da conta, imutavel. */
  updateAvatar: (avatar: string) => void;
  /** Envia uma foto do proprio computador (PNG/JPEG/GIF/WEBP) e ja aplica
   * como avatar da conta — por baixo, sobe pro mesmo UPLOAD_DIR dos anexos
   * de chat (server/attachments.js) e chama updateAvatar com a URL
   * resultante. Lanca em caso de erro (arquivo grande demais, tipo invalido).
   * `onProgress` (0 a 1) e opcional — pra quem quiser mostrar uma barra real. */
  uploadAvatarFile: (file: File, onProgress?: (fraction: number) => void) => Promise<string>;
  menuTarget: { key: string; participantId: string; kind: TileKind; rect: AnchorRect } | null;
  openTileMenu: (key: string, participantId: string, kind: TileKind, rect: AnchorRect) => void;
  /** Retorna true se realmente fechou um menu aberto (idempotente) — usado
   * pelo handler de Escape pra decidir se tambem deve tirar o foco. */
  closeTileMenu: () => boolean;
  reactions: ReactionEvent[];
  sendReaction: (emoji: ReactionEmoji) => void;
  showStats: boolean;
  setShowStats: (value: boolean) => void;
  /** Volume dos efeitos sonoros (0..1) — default 0.65, ver
   * shared/sounds.ts#setVolume e useSettingsPreference.ts. */
  notifyVolume: number;
  setNotifyVolume: (value: number) => void;
  /** Arvore de categorias/canais (texto E o unico canal de voz, a Chamada)
   * — so o admin cria/apaga/reordena (servidor revalida role sempre). */
  categories: Category[];
  activeChannelId: string | null;
  /** Troca o canal ativo — zera o nao-lido dele e busca o historico fresco. */
  openChannel: (channelId: string) => void;
  messagesByChannel: Map<string, ChatMessage[]>;
  /** Mensagens novas chegando pra um canal que nao e o ativo somam aqui —
   * zerado ao abrir o canal (ver openChannel). */
  unreadByChannel: Map<string, number>;
  /** Diretorio de TODAS as contas cadastradas (sidebar direita, so na pagina
   * de Chat) — online/offline vem de `onlineUserIds`, separado. */
  allUsers: Map<string, PublicUser>;
  onlineUserIds: Set<string>;
  /** Erro recuperavel de gerenciar categoria/canal (ex.: apagar categoria
   * nao vazia) — diferente de `state.roomError` (bloqueante de tela inteira). */
  channelsError: string | null;
  clearChannelsError: () => void;
  /** Apaga a conta de outra pessoa pra sempre — aba Moderacao dos Ajustes,
   * admin-only (server/moderation.js revalida role sempre). Mensagens de
   * quem for apagado continuam no historico (nome/avatar ja congelados na
   * hora do envio); so a conta em si deixa de existir. */
  deleteUserAccount: (userId: string) => void;
  /** Erro recuperavel dessa mesma acao (ex.: tentar apagar a propria conta)
   * — mesmo espirito de channelsError, so que pra aba Moderacao. */
  moderationError: string | null;
  clearModerationError: () => void;
  sendChatMessage: (channelId: string, text: string, replyTo?: number) => void;
  deleteChatMessage: (msgId: number) => void;
  /** So o autor original edita — nem admin (server/chat.js revalida). */
  editChatMessage: (msgId: number, text: string) => void;
  /** Alterna a propria reacao naquele emoji (adiciona se nao tinha, tira se
   * ja tinha) — reacao presa a UMA mensagem, diferente de sendReaction (a
   * reacao flutuante "de sala"). */
  reactToChatMessage: (msgId: number, emoji: ReactionEmoji) => void;
  createCategory: (name: string) => void;
  deleteCategory: (categoryId: string) => void;
  renameCategory: (categoryId: string, name: string) => void;
  createChannel: (categoryId: string, name: string) => void;
  deleteChannel: (channelId: string) => void;
  renameChannel: (channelId: string, name: string) => void;
  reorderCategories: (orderedIds: string[]) => void;
  reorderChannels: (categoryId: string, orderedIds: string[]) => void;
  /** Uso da cota de anexos (10GB no total, ver server/attachments.js) —
   * atualiza sozinho a cada upload/apagada de qualquer participante
   * (broadcast `storage-usage`), sem precisar recarregar os Ajustes. */
  storageUsage: StorageUsage;
  /** `onProgress` (0 a 1) e opcional — pra quem quiser mostrar uma barra real
   * (ver ChatComposer). */
  sendAttachment: (channelId: string, file: File, caption: string, onProgress?: (fraction: number) => void) => Promise<void>;
}

export const RoomContext = createContext<RoomContextValue | null>(null);

export function useRoom(): RoomContextValue {
  const ctx = useContext(RoomContext);
  if (!ctx) throw new Error('useRoom() usado fora de <RoomProvider>');
  return ctx;
}

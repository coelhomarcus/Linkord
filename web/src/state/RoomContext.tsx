import { createContext, useContext } from 'react';
import type { Dispatch, MutableRefObject } from 'react';
import type { Room } from 'livekit-client';
import type { ChatMessage, ClientMessage, Conversation, PublicUser, ReactionEmoji, SearchResult, StorageUsage } from '@/shared/types/protocol';
import type { RoomAction, RoomState } from './roomReducer';
import type { TileKind } from '../features/calls/tileTypes';
import type { OutboxEntry } from '@/features/chat/useMessageOutbox';

export interface ReactionEvent {
  key: number;
  id: string;
  emoji: ReactionEmoji;
  left: number;
}

export interface TileDomHandle {
  root: HTMLDivElement;
  video: HTMLVideoElement | null;
}

export interface AudioHandle {
  element: HTMLAudioElement;
}

export interface AnchorRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

// Same shape as react-easy-crop's `Area` — kept local so the state layer
// doesn't depend on that UI library's types.
export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RoomContextValue {
  state: RoomState;
  dispatch: Dispatch<RoomAction>;
  /** False when the socket is down and the message was dropped. */
  sendWs: (msg: ClientMessage) => boolean;
  tileDomRegistry: MutableRefObject<Map<string, TileDomHandle>>;
  audioRegistry: MutableRefObject<Map<string, AudioHandle>>;
  audioUnlocked: boolean;
  deafened: boolean;
  toggleDeafened: () => void;
  reconnecting: boolean;
  livekitRoom: Room;
  notifyActiveView: (view: 'chat' | 'call') => void;
  registerRequestChatView: (fn: () => void) => void;
  requestChatView: () => void;
  activeCallConversationId: string | null;
  joinCall: (conversationId: string) => void;
  leaveCall: () => Promise<void>;
  startSharing: () => Promise<void>;
  stopSharing: () => void;
  startCamera: () => Promise<void>;
  stopCamera: () => void;
  activateMic: () => Promise<void>;
  toggleMicMuted: () => Promise<void>;
  /** Resolves once the server confirms it persisted the whole form (all 8
   * fields); rejects with `ProfileSaveRefused`/`ProfileSaveTimeout`/
   * `ProfileSaveOffline` (see features/profile/useProfileUpdate.ts) otherwise
   * — a caller must never show "salvo" just because this was called. */
  updateProfile: (profile: { avatar: string; avatarPoster: string; avatarColor: string; displayName: string; banner: string; bannerPoster: string; bio: string; profileLinks: string[] }) => Promise<unknown>;
  /** Uploads the file, then persists ONLY that image field — never whatever
   * else happens to be typed in the profile form right now. */
  uploadProfileImage: (field: 'avatar' | 'banner', file: Blob, crop: CropRect, onProgress?: (fraction: number) => void) => Promise<string>;
  /** Same isolation as `uploadProfileImage`, for "remover foto/banner". */
  removeProfileImage: (field: 'avatar' | 'banner') => Promise<unknown>;
  menuTarget: { key: string; participantId: string; kind: TileKind; rect: AnchorRect } | null;
  openTileMenu: (key: string, participantId: string, kind: TileKind, rect: AnchorRect) => void;
  closeTileMenu: () => boolean;
  reactions: ReactionEvent[];
  sendReaction: (emoji: ReactionEmoji) => void;
  showStats: boolean;
  setShowStats: (value: boolean) => void;
  notifyVolume: number;
  setNotifyVolume: (value: number) => void;
  notificationsEnabled: boolean;
  setNotificationsEnabled: (value: boolean) => void;
  hideAudioOnlyTiles: boolean;
  setHideAudioOnlyTiles: (value: boolean) => void;
  showTileBanners: boolean;
  setShowTileBanners: (value: boolean) => void;
  compressImagesDefault: boolean;
  setCompressImagesDefault: (value: boolean) => void;
  noiseSuppressionEnabled: boolean;
  setNoiseSuppressionEnabled: (value: boolean) => Promise<void>;
  noiseSuppressionPending: boolean;
  noiseSuppressionError: string | null;
  conversations: Conversation[];
  activeConversationId: string | null;
  openConversation: (conversationId: string) => void;
  openDirect: (userId: string) => void;
  closeConversation: (conversationId: string) => void;
  pinConversation: (conversationId: string, pinned: boolean) => void;
  deleteGroup: (conversationId: string) => void;
  updateGroupTitle: (conversationId: string, title: string) => void;
  updateGroupAvatar: (conversationId: string, avatar: string) => void;
  removeGroupMember: (conversationId: string, userId: string) => void;
  transferGroupOwnership: (conversationId: string, userId: string) => void;
  messagesByConversation: Map<string, ChatMessage[]>;
  hasMoreByConversation: Map<string, boolean>;
  loadingOlderByConversation: Set<string>;
  unreadByConversation: Map<string, number>;
  typingByConversation: Map<string, Set<string>>;
  sendTyping: (conversationId: string, value: boolean) => void;
  loadOlderMessages: (conversationId: string) => void;
  /** Next page toward the present, for a window opened on old history. */
  loadNewerMessages: (conversationId: string) => void;
  loadingNewerByConversation: Set<string>;
  /** Live messages that arrived while an older window was shown. */
  newerCountByConversation: Map<string, number>;
  /** Changes when a conversation's loaded window is replaced, not extended. */
  windowGenerationByConversation: Map<string, number>;
  allUsers: Map<string, PublicUser>;
  onlineUserIds: Set<string>;
  /** The friend subset of allUsers — see usePresence.ts's own comment. */
  friendUserIds: Set<string>;
  kickFromCall: (participantId: string) => void;
  groupActionError: string | null;
  socialRevision: number;
  clearGroupActionError: () => void;
  // "you were removed from / the group was deleted" — shown app-wide, since
  // the conversation (and any panel about it) is already gone by then
  accessNotice: string | null;
  clearAccessNotice: () => void;
  /** False when nothing was sent (empty text, or the socket is down). */
  sendChatMessage: (conversationId: string, text: string, replyTo?: number) => void;
  /** Your sends the server hasn't confirmed yet, per conversation, in order. */
  pendingByConversation: Map<string, OutboxEntry[]>;
  retryPendingMessage: (clientMessageId: string) => void;
  /** Sends a message with files through the outbox: staged, then published
   * with the message once every file is ready. */
  queueMessageWithFiles: (conversationId: string, text: string, replyTo: number | undefined, files: { file: File; compress: boolean }[]) => void;
  discardPendingMessage: (clientMessageId: string) => void;
  /** Settles once the server answered (protocol 4); a failure lands in
   * messageActionErrors. */
  deleteChatMessage: (msgId: number) => Promise<void>;
  /** Rejects with the server's reason when the edit didn't go through. */
  editChatMessage: (msgId: number, text: string) => Promise<void>;
  deletingMsgIds: Set<number>;
  /** The viewer's unconfirmed reaction intents (see reactionState.ts). */
  pendingReactions: Map<string, boolean>;
  messageActionErrors: Map<number, string>;
  dismissMessageActionError: (msgId: number) => void;
  reactToChatMessage: (msgId: number, emoji: ReactionEmoji) => void;
  replyingTo: ChatMessage | null;
  setReplyingTo: (message: ChatMessage | null) => void;
  editingMsgId: number | null;
  setEditingMsgId: (msgId: number | null) => void;
  hasMoreAfterByConversation: Map<string, boolean>;
  pendingJumpTarget: { conversationId: string; msgId: number } | null;
  clearPendingJumpTarget: () => void;
  jumpToMessage: (conversationId: string, msgId: number) => void;
  searchResults: SearchResult[];
  searchLoading: boolean;
  searchError: string | null;
  clearSearchError: () => void;
  searchMessages: (query: string, conversationId?: string) => void;
  storageUsage: StorageUsage;
}

export const RoomContext = createContext<RoomContextValue | null>(null);

export function useRoom(): RoomContextValue {
  const ctx = useContext(RoomContext);
  if (!ctx) throw new Error('useRoom() usado fora de <RoomProvider>');
  return ctx;
}

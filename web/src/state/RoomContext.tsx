import { createContext, useContext } from 'react';
import type { Dispatch, MutableRefObject } from 'react';
import type { Room } from 'livekit-client';
import type { ChatMessage, ClientMessage, Conversation, PublicUser, ReactionEmoji, SearchResult, StorageUsage } from '../types/protocol';
import type { RoomAction, RoomState } from './roomReducer';
import type { TileKind } from '../features/sharing/tileTypes';

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
  sendWs: (msg: ClientMessage) => void;
  tileDomRegistry: MutableRefObject<Map<string, TileDomHandle>>;
  audioRegistry: MutableRefObject<Map<string, AudioHandle>>;
  audioUnlocked: boolean;
  deafened: boolean;
  toggleDeafened: () => void;
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
  updateAvatar: (avatar: string) => void;
  updateProfile: (profile: { avatar: string; avatarColor: string; displayName: string; banner: string; bio: string; profileLinks: string[] }) => void;
  uploadProfileImage: (
    field: 'avatar' | 'banner',
    file: Blob,
    crop: CropRect,
    onProgress?: (fraction: number) => void,
    profile?: { avatar?: string; avatarColor?: string; displayName?: string; banner?: string; bio?: string; profileLinks?: string[] }
  ) => Promise<string>;
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
  conversations: Conversation[];
  activeConversationId: string | null;
  openConversation: (conversationId: string) => void;
  openDirect: (userId: string) => void;
  closeConversation: (conversationId: string) => void;
  pinConversation: (conversationId: string, pinned: boolean) => void;
  createGroup: (title: string, memberIds: string[]) => void;
  deleteGroup: (conversationId: string) => void;
  updateGroupTitle: (conversationId: string, title: string) => void;
  updateGroupAvatar: (conversationId: string, avatar: string) => void;
  addGroupMembers: (conversationId: string, memberIds: string[]) => void;
  removeGroupMember: (conversationId: string, userId: string) => void;
  messagesByConversation: Map<string, ChatMessage[]>;
  hasMoreByConversation: Map<string, boolean>;
  loadingOlderByConversation: Set<string>;
  unreadByConversation: Map<string, number>;
  loadOlderMessages: (conversationId: string) => void;
  allUsers: Map<string, PublicUser>;
  onlineUserIds: Set<string>;
  deleteUserAccount: (userId: string) => void;
  kickFromCall: (participantId: string) => void;
  moderationError: string | null;
  clearModerationError: () => void;
  sendChatMessage: (conversationId: string, text: string, replyTo?: number) => void;
  deleteChatMessage: (msgId: number) => void;
  editChatMessage: (msgId: number, text: string) => void;
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
  sendAttachments: (conversationId: string, files: File[], caption: string, onProgress?: (fileIndex: number, fraction: number) => void) => Promise<void>;
}

export const RoomContext = createContext<RoomContextValue | null>(null);

export function useRoom(): RoomContextValue {
  const ctx = useContext(RoomContext);
  if (!ctx) throw new Error('useRoom() usado fora de <RoomProvider>');
  return ctx;
}

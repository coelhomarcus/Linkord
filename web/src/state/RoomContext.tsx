import { createContext, useContext } from 'react';
import type { Dispatch, MutableRefObject } from 'react';
import type { Room } from 'livekit-client';
import type { Category, ChatMessage, ClientMessage, PublicUser, ReactionEmoji, SearchResult, StorageUsage } from '../types/protocol';
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
  activeVoiceChannelId: string | null;
  joinVoiceChannel: (channelId: string) => void;
  startSharing: () => Promise<void>;
  stopSharing: () => void;
  startCamera: () => Promise<void>;
  stopCamera: () => void;
  activateMic: () => Promise<void>;
  toggleMicMuted: () => Promise<void>;
  leaveVoiceChannel: () => Promise<void>;
  updateAvatar: (avatar: string) => void;
  updateProfile: (profile: { avatar: string; avatarColor: string; displayName: string; banner: string; bio: string; profileLinks: string[] }) => void;
  uploadProfileImage: (
    field: 'avatar' | 'banner',
    blob: Blob,
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
  categories: Category[];
  activeChannelId: string | null;
  openChannel: (channelId: string) => void;
  messagesByChannel: Map<string, ChatMessage[]>;
  hasMoreByChannel: Map<string, boolean>;
  loadingOlderByChannel: Set<string>;
  loadOlderMessages: (channelId: string) => void;
  unreadByChannel: Map<string, number>;
  allUsers: Map<string, PublicUser>;
  onlineUserIds: Set<string>;
  channelsError: string | null;
  clearChannelsError: () => void;
  deleteUserAccount: (userId: string) => void;
  voiceKickParticipant: (participantId: string) => void;
  moderationError: string | null;
  clearModerationError: () => void;
  sendChatMessage: (channelId: string, text: string, replyTo?: number) => void;
  deleteChatMessage: (msgId: number) => void;
  editChatMessage: (msgId: number, text: string) => void;
  reactToChatMessage: (msgId: number, emoji: ReactionEmoji) => void;
  replyingTo: ChatMessage | null;
  setReplyingTo: (message: ChatMessage | null) => void;
  editingMsgId: number | null;
  setEditingMsgId: (msgId: number | null) => void;
  hasMoreAfterByChannel: Map<string, boolean>;
  pendingJumpTarget: { channelId: string; msgId: number } | null;
  clearPendingJumpTarget: () => void;
  jumpToMessage: (channelId: string, msgId: number) => void;
  searchResults: SearchResult[];
  searchLoading: boolean;
  searchError: string | null;
  clearSearchError: () => void;
  searchMessages: (query: string, channelId?: string) => void;
  createCategory: (name: string) => void;
  deleteCategory: (categoryId: string) => void;
  renameCategory: (categoryId: string, name: string) => void;
  createChannel: (categoryId: string, name: string, type?: 'text' | 'voice') => void;
  deleteChannel: (channelId: string) => void;
  renameChannel: (channelId: string, name: string) => void;
  reorderCategories: (orderedIds: string[]) => void;
  reorderChannels: (categoryId: string, orderedIds: string[]) => void;
  storageUsage: StorageUsage;
  sendAttachments: (channelId: string, files: File[], caption: string, onProgress?: (fileIndex: number, fraction: number) => void) => Promise<void>;
}

export const RoomContext = createContext<RoomContextValue | null>(null);

export function useRoom(): RoomContextValue {
  const ctx = useContext(RoomContext);
  if (!ctx) throw new Error('useRoom() usado fora de <RoomProvider>');
  return ctx;
}

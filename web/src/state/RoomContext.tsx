import { createContext, useContext } from 'react';
import type { Dispatch, MutableRefObject } from 'react';
import type { Room } from 'livekit-client';
import type { Category, ChatMessage, ClientMessage, PublicUser, ReactionEmoji, StorageUsage } from '../types/protocol';
import type { RoomAction, RoomState } from './roomReducer';
import type { TileKind } from '../features/sharing/tileTypes';

/** An active reaction shown in the overlay — `key` is unique per instance
 * (not per participant), since the same person can react repeatedly. */
export interface ReactionEvent {
  key: number;
  id: string;
  emoji: ReactionEmoji;
  /** Horizontal position (% of stage width), rolled once on send — spreads
   * reactions across the screen instead of stacking them. */
  left: number;
}

/** One per tile (mine and remote) — gives TileMenu DOM access (fullscreen/
 * PiP) without the menu being a child of the tile (it's portaled to body).
 * Audio is separate (see AudioHandle) since it must survive a tile's kind
 * changing (camera on/off). */
export interface TileDomHandle {
  root: HTMLDivElement;
  /** null for video-less tiles (audio-only avatar) — nothing to target. */
  video: HTMLVideoElement | null;
}

/** A person's shared audio element (mic or screen audio), registered by
 * ParticipantAudioLayer — survives their tile's kind changing. Key:
 * `participantId` for mic, `${participantId}:screen` for screen audio. */
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
  /** True once the page gets a user gesture — browsers block autoplay-with-
   * sound by default until then. Global, not per-participant. */
  audioUnlocked: boolean;
  /** Stops hearing everyone (mic and screen audio), without touching your
   * own mic. Purely local — not part of the protocol. */
  deafened: boolean;
  toggleDeafened: () => void;
  /** Single stable Room instance for the whole session — connect() happens
   * per voice channel, see joinVoiceChannel. */
  livekitRoom: Room;
  /** Lets the new-message sound know if the user is already looking at chat. */
  notifyActiveView: (view: 'chat' | 'call') => void;
  /** Registers Shell's setActiveView('chat') so clicking a desktop
   * notification can switch to the Chat tab, not just select the channel. */
  registerRequestChatView: (fn: () => void) => void;
  /** Voice channel I'm connected to right now, or null — only changes via
   * joinVoiceChannel/leaveVoiceChannel, never automatically. */
  activeVoiceChannelId: string | null;
  /** Joins a specific voice channel: leaves the current one if different,
   * requests a LiveKit token for it, connects, and activates the mic. */
  joinVoiceChannel: (channelId: string) => void;
  startSharing: () => Promise<void>;
  stopSharing: () => void;
  startCamera: () => Promise<void>;
  stopCamera: () => void;
  /** Requests permission and publishes the mic, unmuted — called by
   * joinVoiceChannel once the Room connects. Idempotent. */
  activateMic: () => Promise<void>;
  /** Assumes activateMic already ran. */
  toggleMicMuted: () => Promise<void>;
  /** Leaves the current voice channel for real (unpublishes mic, stops
   * camera/screen, disconnects the Room, notifies the server). */
  leaveVoiceChannel: () => Promise<void>;
  /** Avatar/photo helper kept for upload and legacy callers. */
  updateAvatar: (avatar: string) => void;
  /** Profile fields editable by the user — username stays the account's
   * immutable handle; displayName resets to it when left blank. */
  updateProfile: (profile: { avatar: string; avatarColor: string; displayName: string; banner: string; bio: string; profileLinks: string[] }) => void;
  /** Uploads a local image (already cropped, see ImageCropDialog) and
   * applies it to the given profile field (avatar or banner). Throws on
   * error (too large, invalid type). `onProgress` (0 to 1) and the rest of
   * `profile` are optional — omitted, the current value is kept. */
  uploadProfileImage: (
    field: 'avatar' | 'banner',
    blob: Blob,
    onProgress?: (fraction: number) => void,
    profile?: { avatar?: string; avatarColor?: string; displayName?: string; banner?: string; bio?: string; profileLinks?: string[] }
  ) => Promise<string>;
  menuTarget: { key: string; participantId: string; kind: TileKind; rect: AnchorRect } | null;
  openTileMenu: (key: string, participantId: string, kind: TileKind, rect: AnchorRect) => void;
  /** Returns true if it actually closed an open menu — used by the Escape
   * handler to decide whether to also clear focus. */
  closeTileMenu: () => boolean;
  reactions: ReactionEvent[];
  sendReaction: (emoji: ReactionEmoji) => void;
  showStats: boolean;
  setShowStats: (value: boolean) => void;
  /** Sound-effects volume (0..1), default 0.65. */
  notifyVolume: number;
  setNotifyVolume: (value: number) => void;
  /** Desktop (OS-level) notifications for chat messages — default on.
   * Turning it on (if not already granted) requests browser Notification
   * permission. */
  notificationsEnabled: boolean;
  setNotificationsEnabled: (value: boolean) => void;
  /** Call grid filter — hides plain audio-only tiles (kind 'avatar'),
   * keeping only camera/screen-share tiles. Toggled from the Stage's
   * context menu. */
  hideAudioOnlyTiles: boolean;
  setHideAudioOnlyTiles: (value: boolean) => void;
  /** Category/channel tree (text and voice) — only admins create/delete/
   * reorder (server always revalidates). */
  categories: Category[];
  activeChannelId: string | null;
  /** Switches the active channel — clears its unread count and fetches
   * fresh history. */
  openChannel: (channelId: string) => void;
  messagesByChannel: Map<string, ChatMessage[]>;
  /** Per-channel: whether OLDER history beyond what's loaded may still
   * exist. Absent (channel never opened) is treated as "maybe" by callers. */
  hasMoreByChannel: Map<string, boolean>;
  /** Channels with a 'load-more-messages' request currently in flight. */
  loadingOlderByChannel: Set<string>;
  /** Fetches the next page of OLDER messages and prepends them — call when
   * the user scrolls to the top of an open channel. No-ops if a page is
   * already loading, history is known to be exhausted, or nothing is
   * loaded yet for this channel. */
  loadOlderMessages: (channelId: string) => void;
  /** New messages for a channel that isn't active accumulate here —
   * cleared on openChannel. */
  unreadByChannel: Map<string, number>;
  /** Directory of ALL registered accounts (right sidebar, Chat page only) —
   * online/offline comes from `onlineUserIds`, separately. */
  allUsers: Map<string, PublicUser>;
  onlineUserIds: Set<string>;
  /** Recoverable channel-management error (e.g. deleting a non-empty
   * category) — distinct from `state.roomError` (a full-screen blocker). */
  channelsError: string | null;
  clearChannelsError: () => void;
  /** Permanently deletes another account — Moderation tab, admin-only
   * (server always revalidates role). Their past messages stay in history
   * and resolve to a neutral deleted-user fallback. */
  deleteUserAccount: (userId: string) => void;
  /** Same idea as channelsError, for the Moderation tab. */
  moderationError: string | null;
  clearModerationError: () => void;
  sendChatMessage: (channelId: string, text: string, replyTo?: number) => void;
  deleteChatMessage: (msgId: number) => void;
  /** Only the original author can edit — not even admin (server revalidates). */
  editChatMessage: (msgId: number, text: string) => void;
  /** Toggles my own reaction on that emoji — tied to ONE message, unlike
   * sendReaction (the floating room-wide reaction). */
  reactToChatMessage: (msgId: number, emoji: ReactionEmoji) => void;
  /** The message currently being replied to (shows the banner above the
   * composer) — lives here, not in ChatPage's own state, so both the
   * composer/message list AND the global right-click menu (GlobalContextMenu,
   * mounted at the app root) can set/read it. Reset to null on channel
   * switch. */
  replyingTo: ChatMessage | null;
  setReplyingTo: (message: ChatMessage | null) => void;
  /** msgId of the message currently in inline-edit mode, or null — same
   * "needs to be reachable from GlobalContextMenu" reasoning as replyingTo.
   * The draft text itself stays local to ChatMessageList (see its own
   * editText state), re-seeded from the message whenever this changes. */
  editingMsgId: number | null;
  setEditingMsgId: (msgId: number | null) => void;
  createCategory: (name: string) => void;
  deleteCategory: (categoryId: string) => void;
  renameCategory: (categoryId: string, name: string) => void;
  createChannel: (categoryId: string, name: string, type?: 'text' | 'voice') => void;
  deleteChannel: (channelId: string) => void;
  renameChannel: (channelId: string, name: string) => void;
  reorderCategories: (orderedIds: string[]) => void;
  reorderChannels: (categoryId: string, orderedIds: string[]) => void;
  /** Attachment quota usage — updates itself on every upload/delete
   * (`storage-usage` broadcast), no reload needed. */
  storageUsage: StorageUsage;
  /** Uploads up to MAX_ATTACHMENTS_PER_MESSAGE files as ONE message — the
   * first creates it, the rest attach to it. `onProgress(fileIndex, fraction)`
   * is optional; fileIndex is the index into `files`. */
  sendAttachments: (channelId: string, files: File[], caption: string, onProgress?: (fileIndex: number, fraction: number) => void) => Promise<void>;
}

export const RoomContext = createContext<RoomContextValue | null>(null);

export function useRoom(): RoomContextValue {
  const ctx = useContext(RoomContext);
  if (!ctx) throw new Error('useRoom() usado fora de <RoomProvider>');
  return ctx;
}

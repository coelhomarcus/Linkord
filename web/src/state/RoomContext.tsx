import { createContext, useContext } from 'react';
import type { Dispatch, MutableRefObject } from 'react';
import type { Room } from 'livekit-client';
import type { Category, ChatMessage, ClientMessage, PublicUser, ReactionEmoji, StorageUsage } from '../types/protocol';
import type { RoomAction, RoomState } from './roomReducer';
import type { Quality } from '../features/settings/useQualityPreference';
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

export type VoiceConnectionStatus = 'idle' | 'joining' | 'connected' | 'failed';
export type VoiceConnectionMode = 'voice' | 'listen-only';

export interface VoiceJoinOptions {
  /** Start with a published, muted mic. Ignored in listen-only mode. */
  muted?: boolean;
  /** Connect to LiveKit without requesting microphone permission. */
  listenOnly?: boolean;
}

export interface VoiceConnectionState {
  status: VoiceConnectionStatus;
  /** Target while joining/failed; current channel while connected. */
  channelId: string | null;
  mode: VoiceConnectionMode;
  /** Retained so retry repeats the user's pre-call choice. */
  joinMuted: boolean;
  error: string | null;
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
  /** Voice channel I'm connected to right now, or null — only changes via
   * joinVoiceChannel/leaveVoiceChannel, never automatically. */
  activeVoiceChannelId: string | null;
  /** Explicit LiveKit entry state, including recoverable failures. */
  voiceConnection: VoiceConnectionState;
  /** Joins a specific voice channel: leaves the current one if different,
   * requests a LiveKit token and honors pre-call mic/listen-only options. */
  joinVoiceChannel: (channelId: string, options?: VoiceJoinOptions) => Promise<void>;
  retryVoiceChannel: () => void;
  cancelVoiceJoin: () => Promise<void>;
  startSharing: () => Promise<void>;
  stopSharing: () => void;
  startCamera: () => Promise<void>;
  stopCamera: () => void;
  /** Requests permission after a listen-only join and promotes the session
   * to normal voice mode. Honors deafen by activating muted. */
  enableMicrophone: () => Promise<void>;
  /** Toggles an already-published microphone; no-op outside a call. */
  toggleMicMuted: () => Promise<void>;
  /** Leaves the current voice channel for real (unpublishes mic, stops
   * camera/screen, disconnects the Room, notifies the server). */
  leaveVoiceChannel: () => Promise<void>;
  quality: Quality;
  setQuality: (q: Quality) => void;
  /** Only the avatar is editable — name is the account's immutable username. */
  updateAvatar: (avatar: string) => void;
  /** Uploads a local file and applies it as the account avatar. Throws on
   * error (too large, invalid type). `onProgress` (0 to 1) is optional. */
  uploadAvatarFile: (file: File, onProgress?: (fraction: number) => void) => Promise<string>;
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
  /** Category/channel tree (text and voice) — only admins create/delete/
   * reorder (server always revalidates). */
  categories: Category[];
  activeChannelId: string | null;
  /** Switches the active channel — clears its unread count and fetches
   * fresh history. */
  openChannel: (channelId: string) => void;
  messagesByChannel: Map<string, ChatMessage[]>;
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
   * (server always revalidates role). Their past messages keep their
   * frozen name/avatar; only the account itself stops existing. */
  deleteUserAccount: (userId: string) => void;
  /** Same idea as channelsError, for the Moderation tab. */
  moderationError: string | null;
  clearModerationError: () => void;
  sendChatMessage: (channelId: string, text: string, replyTo?: number) => void;
  /** Re-sends a message stuck in `pending: 'failed'` with the same content
   * and clientId. No-op if it isn't pending anymore (already confirmed). */
  retryChatMessage: (channelId: string, clientId: string) => void;
  /** Removes a failed send from the local list only — nothing to tell the
   * server, it never has a row for this message. */
  discardFailedChatMessage: (channelId: string, clientId: string) => void;
  deleteChatMessage: (msgId: number) => void;
  /** Only the original author can edit — not even admin (server revalidates). */
  editChatMessage: (msgId: number, text: string) => void;
  /** Toggles my own reaction on that emoji — tied to ONE message, unlike
   * sendReaction (the floating room-wide reaction). */
  reactToChatMessage: (msgId: number, emoji: ReactionEmoji) => void;
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
  /** `onProgress` (0 to 1) is optional. */
  sendAttachment: (channelId: string, file: File, caption: string, onProgress?: (fraction: number) => void) => Promise<void>;
}

export const RoomContext = createContext<RoomContextValue | null>(null);

export function useRoom(): RoomContextValue {
  const ctx = useContext(RoomContext);
  if (!ctx) throw new Error('useRoom() usado fora de <RoomProvider>');
  return ctx;
}

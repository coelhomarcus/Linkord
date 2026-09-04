/** WebSocket protocol (/ws). Manually kept in sync with the server — no
 * codegen. */

export interface Participant {
  id: string;
  // account id (stable across reconnects/tabs) — keeps the user directory
  // (allUsers) in sync when avatar/role change mid-session.
  userId: string;
  name: string; // account username — unique, immutable
  avatar: string; // '' when none
  role: 'user' | 'admin';
  // no LiveKit track equivalent — a flag the client announces (see
  // ClientMessage 'deafened') so others can show the icon.
  deafened: boolean;
  // voice channel they're in now, or null — set by the server only on
  // explicit 'voice-join'/'voice-leave', never just from having the tab open.
  voiceChannelId: string | null;
}

// short fixed list — avoids accepting arbitrary text as a "reaction"
export const ALLOWED_REACTIONS = ['👍', '❤️', '😂', '😮', '👏', '🎉'] as const;
export type ReactionEmoji = (typeof ALLOWED_REACTIONS)[number];

// frozen snapshot of the original message at reply time — same idea as
// name/avatar on ChatMessage, doesn't depend on the original still existing.
export interface ChatReplyRef {
  msgId: number;
  name: string;
  text: string;
}

// `id` here is the account's userId (not a connection id) — survives
// reconnects since the message itself is persisted per channel.
export interface ChatMessage {
  msgId: number;
  channelId: string;
  // null when the sender's account was deleted (author_id set to NULL via
  // ON DELETE SET NULL) — name/avatar stay valid (frozen at send time).
  // Comparing against state.me.userId already handles null safely; using
  // `id` as a color seed (Avatar/colorFor) needs its own fallback.
  id: string | null;
  name: string;
  avatar: string;
  text: string;
  ts: number;
  replyTo?: ChatReplyRef;
  editedAt?: number;
  // emoji -> userIds who reacted — key disappears when the last one toggles
  // off, never stored as an empty array.
  reactions?: Partial<Record<ReactionEmoji, string[]>>;
  attachment?: ChatAttachment;
}

// max one per message. `id` doubles as the download/display path:
// `/uploads/${id}`.
export interface ChatAttachment {
  id: string;
  name: string;
  mime: string;
  size: number;
}
export const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024 * 1024; // UI-only, server always revalidates
// avatar — smaller cap, same upload route as attachments. UI-only, server revalidates.
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
export const AVATAR_MIME_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;

export interface StorageUsage {
  totalBytes: number;
  totalFiles: number;
  maxBytes: number;
}

// 'text' or 'voice' — admins create/delete/reorder either freely (only the
// LAST voice channel is protected from deletion).
export interface Channel {
  id: string;
  name: string;
  type: 'text' | 'voice';
}
export interface Category {
  id: string;
  name: string;
  channels: Channel[];
}

export interface PublicUser {
  id: string;
  username: string;
  avatar: string;
  role: 'user' | 'admin';
}

export type ClientMessage =
  // identity comes from the session cookie resolved at handshake — id/token
  // here are only a per-tab RECONNECT resume, never a claim of identity.
  | { t: 'join'; id?: string; token?: string }
  // name isn't editable (it's the account's immutable username) — avatar only.
  | { t: 'profile'; avatar: string }
  | { t: 'reaction'; emoji: ReactionEmoji }
  | { t: 'deafened'; value: boolean }
  | { t: 'channel-open'; channelId: string }
  | { t: 'chat'; channelId: string; text: string; replyTo?: number }
  | { t: 'chat-delete'; msgId: number }
  | { t: 'chat-edit'; msgId: number; text: string }
  | { t: 'chat-react'; msgId: number; emoji: ReactionEmoji }
  // category/channel management — admin-only, server always revalidates the role.
  | { t: 'category-create'; name: string }
  | { t: 'category-delete'; categoryId: string }
  | { t: 'category-rename'; categoryId: string; name: string }
  | { t: 'channel-create'; categoryId: string; name: string; type?: 'text' | 'voice' }
  | { t: 'channel-delete'; channelId: string }
  | { t: 'channel-rename'; channelId: string; name: string }
  // delete an account — Moderation tab, admin-only (server revalidates,
  // same as channel mutations above).
  | { t: 'user-delete'; userId: string }
  | { t: 'categories-reorder'; orderedIds: string[] }
  // also covers moving a channel to another category: sends the
  // destination category's full final list.
  | { t: 'channels-reorder'; categoryId: string; orderedIds: string[] }
  // optional Discord webhook — client reports its OWN action (never on
  // behalf of someone else), since the server has no visibility into who's
  // in the call/sharing (that lives in LiveKit only).
  | { t: 'call-event'; kind: 'joined' | 'screenshare' }
  // join/leave a specific voice channel — the only thing that mints a
  // LiveKit token (see ServerMessage 'voice-token') and sets voiceChannelId;
  // having the tab open no longer does this by itself.
  | { t: 'voice-join'; channelId: string }
  | { t: 'voice-leave' }
  | { t: 'leave' }
  | { t: 'ping' };

export type ServerMessage =
  | {
      t: 'welcome'; id: string; token: string;
      // authoritative account identity — from the session, not the client
      userId: string; name: string; avatar: string; role: 'user' | 'admin';
      maxParticipants: number; participants: Participant[];
      categories: Category[]; users: PublicUser[]; onlineUserIds: string[];
      storageUsage: StorageUsage;
      // just the endpoint (not secret) — the access TOKEN now only arrives
      // later, in response to an explicit 'voice-join' for a specific
      // channel (see 'voice-token').
      livekitUrl: string;
    }
  // response to 'voice-join' — credentials for that channel's LiveKit Room.
  // Never arrives if LIVEKIT_API_KEY/SECRET aren't configured or the
  // channel is invalid; the client gets an 'error' instead.
  | { t: 'voice-token'; channelId: string; livekitUrl: string; livekitToken: string }
  | { t: 'participant-joined'; participant: Participant }
  | { t: 'participant-updated'; participant: Participant }
  | { t: 'participant-left'; id: string }
  | { t: 'reaction'; id: string; emoji: ReactionEmoji }
  | { t: 'channel-history'; channelId: string; messages: ChatMessage[] }
  | { t: 'chat'; message: ChatMessage }
  | { t: 'chat-deleted'; channelId: string; msgId: number }
  | { t: 'chat-edited'; message: ChatMessage }
  | { t: 'chat-reaction-updated'; channelId: string; msgId: number; emoji: ReactionEmoji; userIds: string[] }
  // full fresh tree after any category/channel mutation — simpler and
  // harder to desync than incremental events; the tree is small (only
  // admins touch it).
  | { t: 'channels-tree'; categories: Category[] }
  | { t: 'channel-deleted'; channelId: string }
  | { t: 'user-online'; userId: string }
  | { t: 'user-offline'; userId: string }
  | { t: 'user-registered'; user: PublicUser }
  | { t: 'user-deleted'; userId: string }
  | ({ t: 'storage-usage' } & StorageUsage)
  | { t: 'error'; code: string; message: string }
  | { t: 'pong' }
  | { t: 'server-restart' };

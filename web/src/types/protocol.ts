/** WebSocket protocol (/ws). Manually kept in sync with the server — no
 * codegen. */

export interface Participant {
  id: string;
  // account id (stable across reconnects/tabs) — keeps the user directory
  // (allUsers) in sync when avatar/role change mid-session.
  userId: string;
  name: string; // account username — unique, immutable
  // editable, non-unique — what's shown everywhere in the UI instead of
  // `name`. Always non-empty (falls back to `name` server-side).
  displayName: string;
  avatar: string; // '' when none
  avatarColor: string; // palette key; '' only appears for legacy fallback data
  banner: string;
  bio: string;
  profileLinks: string[];
  role: 'user' | 'admin';
  // no LiveKit track equivalent — a flag the client announces (see
  // ClientMessage 'deafened') so others can show the icon.
  deafened: boolean;
  // voice channel they're in now, or null — set by the server only on
  // explicit 'voice-join'/'voice-leave', never just from having the tab open.
  voiceChannelId: string | null;
  // self-reported by each client (see ClientMessage 'mic-state'/'camera'/
  // 'screen-share'/'speaking') — LiveKit only tells ME about people in MY
  // OWN room, so this is what lets the sidebar show accurate icons for
  // anyone in ANY voice channel, not just the one I'm connected to (see
  // ChannelTree.tsx#CallParticipantRow). Reset to the defaults below on
  // every 'voice-join'/'voice-leave' (server-side), so a stale value never
  // survives a channel switch.
  micActivated: boolean;
  micMuted: boolean;
  cameraOn: boolean;
  sharing: boolean;
  speaking: boolean;
}

// short fixed list — avoids accepting arbitrary text as a "reaction"
export const ALLOWED_REACTIONS = ['👍', '❤️', '😂', '😮', '👏', '🎉'] as const;
export type ReactionEmoji = (typeof ALLOWED_REACTIONS)[number];

// Compact reference to the original message at reply time. It keeps only
// stable ids/text preview; profile data is resolved through allUsers when
// rendered so replies follow displayName/avatar changes too.
export interface ChatReplyRef {
  msgId: number;
  authorId: string | null;
  text: string;
  // only set when `text` is empty (an attachment-only message) — lets the
  // reply reference show "📎 N anexos" instead of a blank snippet.
  attachmentCount?: number;
}

// `id` here is the account's userId (not a connection id) — survives
// reconnects since the message itself is persisted per channel.
export interface ChatMessage {
  msgId: number;
  channelId: string;
  // null when the sender's account was deleted (author_id set to NULL via
  // ON DELETE SET NULL). Comparing against state.me.userId already handles
  // null safely; using `id` as a color seed (Avatar/colorFor) needs its own
  // fallback.
  id: string | null;
  // Server-derived fallback for deleted/missing authors. Active accounts are
  // rendered from allUsers so mutable profile fields update across history.
  name: string;
  avatar: string;
  text: string;
  ts: number;
  replyTo?: ChatReplyRef;
  editedAt?: number;
  // emoji -> userIds who reacted — key disappears when the last one toggles
  // off, never stored as an empty array.
  reactions?: Partial<Record<ReactionEmoji, string[]>>;
  attachments?: ChatAttachment[];
}

// up to MAX_ATTACHMENTS_PER_MESSAGE per message. `id` doubles as the
// download/display path: `/uploads/${id}`.
export interface ChatAttachment {
  id: string;
  name: string;
  mime: string;
  size: number;
}
export const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024 * 1024; // UI-only, server always revalidates
export const MAX_ATTACHMENTS_PER_MESSAGE = 4; // UI-only, server always revalidates
// avatar — smaller cap, same upload route as attachments. UI-only, server revalidates.
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
export const AVATAR_MIME_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;
export const MAX_BANNER_LEN = 500;
export const MAX_PROFILE_BIO_LEN = 300;
export const MAX_PROFILE_LINKS = 8;
export const MAX_PROFILE_LINK_LEN = 300;

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
  displayName: string;
  avatar: string;
  avatarColor: string;
  banner: string;
  bio: string;
  profileLinks: string[];
  role: 'user' | 'admin';
}

export type ClientMessage =
  // identity comes from the session cookie resolved at handshake — id/token
  // here are only a per-tab RECONNECT resume, never a claim of identity.
  | { t: 'join'; id?: string; token?: string }
  // username isn't editable — displayName is (free-form, falls back to
  // username server-side when blank).
  | { t: 'profile'; avatar: string; avatarColor: string; displayName: string; banner: string; bio: string; profileLinks: string[] }
  | { t: 'reaction'; emoji: ReactionEmoji }
  | { t: 'deafened'; value: boolean }
  // self-reported media state — same pattern as 'deafened' above, just
  // split per field since each fires independently. Lets anyone (not just
  // people in the same LiveKit room) see accurate camera/screen/mic icons
  // for this participant (see Participant above and CallParticipantRow).
  | { t: 'mic-state'; activated: boolean; muted: boolean }
  | { t: 'camera'; on: boolean }
  | { t: 'screen-share'; on: boolean }
  | { t: 'speaking'; value: boolean }
  | { t: 'channel-open'; channelId: string }
  // requests the next page of OLDER history for a channel already open —
  // beforeMsgId is the smallest msgId currently loaded on the client, so
  // the server returns messages strictly before it (see ServerMessage
  // 'channel-history-more').
  | { t: 'load-more-messages'; channelId: string; beforeMsgId: number }
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
      userId: string; name: string; displayName: string; avatar: string; avatarColor: string;
      banner: string; bio: string; profileLinks: string[]; role: 'user' | 'admin';
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
  // hasMore: true when the channel may still have OLDER messages beyond
  // this page — a heuristic (page came back full), not a guarantee, so an
  // empty follow-up 'channel-history-more' page can still correct it to
  // false.
  | { t: 'channel-history'; channelId: string; messages: ChatMessage[]; hasMore: boolean }
  // response to 'load-more-messages' — an older page to PREPEND to
  // existing history, not replace it.
  | { t: 'channel-history-more'; channelId: string; messages: ChatMessage[]; hasMore: boolean }
  | { t: 'chat'; message: ChatMessage }
  | { t: 'chat-deleted'; channelId: string; msgId: number }
  | { t: 'chat-edited'; message: ChatMessage }
  | { t: 'chat-reaction-updated'; channelId: string; msgId: number; emoji: ReactionEmoji; userIds: string[] }
  // one more attachment (2nd-4th) landed on a message whose first
  // attachment already created it — see attachments.ts#handleAttachmentComplete.
  | { t: 'chat-attachment-added'; channelId: string; msgId: number; attachment: ChatAttachment }
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


export interface Participant {
  id: string;
  userId: string;
  name: string;
  displayName: string;
  avatar: string;
  avatarPoster: string;
  avatarColor: string;
  banner: string;
  bannerPoster: string;
  bio: string;
  profileLinks: string[];
  role: 'user' | 'admin';
  deafened: boolean;
  callConversationId: string | null;
  micActivated: boolean;
  micMuted: boolean;
  cameraOn: boolean;
  sharing: boolean;
  speaking: boolean;
}

export type ReactionEmoji = string;

/** Wire protocol version this build speaks; the server refuses older ones (client_outdated). */
export const PROTOCOL_VERSION = 2;

export interface ChatReplyRef {
  msgId: number;
  authorId: string | null;
  text: string;
  attachmentCount?: number;
}

export type InvitationStatus = 'pending' | 'accepted' | 'declined' | 'revoked' | 'expired';

/** The live state of a group invitation, as embedded in a `group_invite`
 * message. `expired` only appears on invitations that lapsed before they
 * stopped expiring. */
export interface InvitationCard {
  id: string;
  status: InvitationStatus;
  groupId: string;
  groupTitle: string;
  groupAvatar: string;
  memberCount: number;
  inviterId: string;
  inviteeId: string;
  version: number;
}

export interface ChatMessage {
  msgId: number;
  conversationId: string;
  id: string | null;
  name: string;
  avatar: string;
  text: string;
  ts: number;
  replyTo?: ChatReplyRef;
  editedAt?: number;
  reactions?: Partial<Record<ReactionEmoji, string[]>>;
  attachments?: ChatAttachment[];
  kind?: 'text' | 'group_invite';
  // `null` on a group_invite message = the group is gone (tombstone)
  invitation?: InvitationCard | null;
}

export interface ChatAttachment {
  id: string;
  name: string;
  mime: string;
  size: number;
  // Present for image attachments with a generated preview — smaller,
  // resized copy for thumbnails. The ORIGINAL (`id`) is still what full-size
  // views (lightbox, download) use.
  thumbId?: string;
}
export const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_MESSAGE = 4;
export const MAX_AVATAR_BYTES = 12 * 1024 * 1024;
export const AVATAR_MIME_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;
export const MAX_BANNER_LEN = 500;
export const MAX_PROFILE_BIO_LEN = 300;
export const MAX_PROFILE_LINKS = 8;
export const MAX_PROFILE_LINK_LEN = 300;

export interface SearchResult {
  msgId: number;
  conversationId: string;
  conversationName: string;
  id: string | null;
  name: string;
  avatar: string;
  ts: number;
  snippet: string;
}

export interface StorageUsage {
  totalBytes: number;
  totalFiles: number;
  maxBytes: number;
}

export interface Conversation {
  id: string;
  type: 'direct' | 'group';
  title: string;
  avatar: string;
  createdBy: string | null;
  memberIds: string[];
  lastMessageAt: number | null;
  createdAt: number;
  updatedAt: number;
  pinnedAt: number | null;
  // the viewer's own role in this conversation — 'member' for every DM (DMs
  // have no owner). Real per-group authority, not the account's global role.
  myRole: 'owner' | 'member';
  // derived on the server from the owner's membership row; null for a DM
  ownerId: string | null;
  memberCount: number;
  // 'suspended' = moderated away by an administrator: still listed, but no access
  status?: 'active' | 'suspended';
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

/** Only the fields present are changed — everything else keeps its last
 * confirmed value on the server. A media-only patch (after an avatar/banner
 * upload) omits the text fields entirely, so it can never publish a draft
 * that hasn't been saved. `requestId` correlates the `profile-result`. */
export type ProfilePatch = Partial<{
  avatar: string; avatarPoster: string; avatarColor: string; displayName: string;
  banner: string; bannerPoster: string; bio: string; profileLinks: string[];
}>;

export type ClientMessage =
  | { t: 'join'; id?: string; token?: string; v: number }
  | ({ t: 'profile'; requestId: string } & ProfilePatch)
  | { t: 'reaction'; emoji: ReactionEmoji }
  | { t: 'deafened'; value: boolean }
  | { t: 'mic-state'; activated: boolean; muted: boolean }
  | { t: 'camera'; on: boolean }
  | { t: 'screen-share'; on: boolean }
  | { t: 'speaking'; value: boolean }
  | { t: 'conversation-open'; conversationId: string }
  | { t: 'direct-open'; userId: string }
  | { t: 'conversation-close'; conversationId: string }
  | { t: 'conversation-pin'; conversationId: string; pinned: boolean }
  | { t: 'group-delete'; conversationId: string }
  | { t: 'group-update'; conversationId: string; title?: string; avatar?: string }
  | { t: 'group-members-remove'; conversationId: string; userId: string }
  | { t: 'group-transfer-owner'; conversationId: string; userId: string }
  | { t: 'load-more-messages'; conversationId: string; beforeMsgId: number }
  | { t: 'load-messages-around'; conversationId: string; msgId: number }
  | { t: 'message-search'; query: string; conversationId?: string }
  | { t: 'chat'; conversationId: string; text: string; replyTo?: number }
  | { t: 'chat-delete'; msgId: number }
  | { t: 'chat-edit'; msgId: number; text: string }
  | { t: 'chat-react'; msgId: number; emoji: ReactionEmoji }
  | { t: 'typing'; conversationId: string; value: boolean }
  | { t: 'call-join'; conversationId: string }
  | { t: 'call-leave' }
  | { t: 'call-kick'; participantId: string }
  | { t: 'leave' }
  | { t: 'ping' };

export type ServerMessage =
  | {
      t: 'welcome'; id: string; token: string;
      userId: string; name: string; displayName: string; avatar: string; avatarPoster: string; avatarColor: string;
      banner: string; bannerPoster: string; bio: string; profileLinks: string[]; role: 'user' | 'admin';
      maxParticipants: number; participants: Participant[];
      conversations: Conversation[]; knownUsers: PublicUser[]; onlineUserIds: string[]; friendIds: string[];
      storageUsage: StorageUsage;
      livekitUrl: string;
    }
  | { t: 'call-token'; conversationId: string; livekitUrl: string; livekitToken: string }
  | { t: 'conversation-opened'; conversationId: string; conversation: Conversation }
  | { t: 'conversation-created'; conversation: Conversation }
  | { t: 'conversation-updated'; conversation: Conversation }
  | { t: 'conversation-member-added'; conversationId: string; userId: string }
  | { t: 'conversation-member-removed'; conversationId: string; userId: string }
  | { t: 'conversation-pinned'; conversationId: string; pinnedAt: number | null }
  | { t: 'conversation-read'; conversationId: string; lastReadMessageId: number }
  | { t: 'conversation-history'; conversationId: string; messages: ChatMessage[]; hasMore: boolean }
  | { t: 'conversation-history-more'; conversationId: string; messages: ChatMessage[]; hasMore: boolean }
  | { t: 'conversation-history-around'; conversationId: string; msgId: number; messages: ChatMessage[]; hasMoreBefore: boolean; hasMoreAfter: boolean }
  | { t: 'conversation-deleted'; conversationId: string; reason?: 'removed' | 'deleted' }
  | { t: 'participant-joined'; participant: Participant }
  | { t: 'participant-updated'; participant: Participant }
  | { t: 'participant-left'; id: string }
  | { t: 'reaction'; id: string; emoji: ReactionEmoji }
  | { t: 'message-search-results'; query: string; conversationId?: string; results: SearchResult[] }
  | { t: 'chat'; message: ChatMessage }
  | { t: 'chat-deleted'; conversationId: string; msgId: number }
  | { t: 'chat-edited'; message: ChatMessage }
  | { t: 'invitation-updated'; invitation: InvitationCard }
  | { t: 'role-updated'; role: 'user' | 'admin' }
  | { t: 'chat-reaction-updated'; conversationId: string; msgId: number; emoji: ReactionEmoji; userIds: string[] }
  | { t: 'typing'; conversationId: string; userId: string; value: boolean }
  | { t: 'chat-attachment-added'; conversationId: string; msgId: number; attachment: ChatAttachment }
  // payload-free: "your friends/requests/blocks changed, refetch" — the data
  // itself only ever travels over the authorized HTTP endpoints
  | { t: 'social-changed' }
  // the scoped snapshot re-sent when this connection's known peers change
  // (same shape the welcome carries)
  | { t: 'presence-sync'; knownUsers: PublicUser[]; participants: Participant[]; onlineUserIds: string[]; friendIds: string[] }
  | { t: 'user-online'; userId: string }
  | { t: 'user-offline'; userId: string }
  | { t: 'user-deleted'; userId: string }
  | ({ t: 'storage-usage' } & StorageUsage)
  // answers the `profile` patch of the same requestId, once the server has
  // actually persisted it (or refused to) — never inferred from
  // `participant-updated`, which a different account's edit also triggers
  | ({ t: 'profile-result'; requestId: string; ok: true } & ProfilePatch)
  | { t: 'profile-result'; requestId: string; ok: false; code: string; message: string }
  | { t: 'error'; code: string; message: string }
  | { t: 'pong' }
  | { t: 'server-restart' };


export interface Participant {
  id: string;
  userId: string;
  name: string;
  displayName: string;
  avatar: string;
  avatarColor: string;
  banner: string;
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

export const ALLOWED_REACTIONS = ['👍', '❤️', '😂', '😮', '👏', '🎉'] as const;
export type ReactionEmoji = (typeof ALLOWED_REACTIONS)[number];

export interface ChatReplyRef {
  msgId: number;
  authorId: string | null;
  text: string;
  attachmentCount?: number;
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
}

export interface ChatAttachment {
  id: string;
  name: string;
  mime: string;
  size: number;
}
export const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_MESSAGE = 4;
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
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
  | { t: 'join'; id?: string; token?: string }
  | { t: 'profile'; avatar: string; avatarColor: string; displayName: string; banner: string; bio: string; profileLinks: string[] }
  | { t: 'reaction'; emoji: ReactionEmoji }
  | { t: 'deafened'; value: boolean }
  | { t: 'mic-state'; activated: boolean; muted: boolean }
  | { t: 'camera'; on: boolean }
  | { t: 'screen-share'; on: boolean }
  | { t: 'speaking'; value: boolean }
  | { t: 'conversation-open'; conversationId: string }
  | { t: 'direct-open'; userId: string }
  | { t: 'group-create'; title: string; memberIds: string[] }
  | { t: 'group-delete'; conversationId: string }
  | { t: 'group-update'; conversationId: string; title?: string; avatar?: string }
  | { t: 'group-members-add'; conversationId: string; memberIds: string[] }
  | { t: 'group-members-remove'; conversationId: string; userId: string }
  | { t: 'load-more-messages'; conversationId: string; beforeMsgId: number }
  | { t: 'load-messages-around'; conversationId: string; msgId: number }
  | { t: 'message-search'; query: string; conversationId?: string }
  | { t: 'chat'; conversationId: string; text: string; replyTo?: number }
  | { t: 'chat-delete'; msgId: number }
  | { t: 'chat-edit'; msgId: number; text: string }
  | { t: 'chat-react'; msgId: number; emoji: ReactionEmoji }
  | { t: 'user-delete'; userId: string }
  | { t: 'call-event'; kind: 'joined' | 'screenshare' }
  | { t: 'call-join'; conversationId: string }
  | { t: 'call-leave' }
  | { t: 'call-kick'; participantId: string }
  | { t: 'leave' }
  | { t: 'ping' };

export type ServerMessage =
  | {
      t: 'welcome'; id: string; token: string;
      userId: string; name: string; displayName: string; avatar: string; avatarColor: string;
      banner: string; bio: string; profileLinks: string[]; role: 'user' | 'admin';
      maxParticipants: number; participants: Participant[];
      conversations: Conversation[]; users: PublicUser[]; onlineUserIds: string[];
      storageUsage: StorageUsage;
      livekitUrl: string;
    }
  | { t: 'call-token'; conversationId: string; livekitUrl: string; livekitToken: string }
  | { t: 'conversation-list'; conversations: Conversation[] }
  | { t: 'conversation-opened'; conversationId: string }
  | { t: 'conversation-history'; conversationId: string; messages: ChatMessage[]; hasMore: boolean }
  | { t: 'conversation-history-more'; conversationId: string; messages: ChatMessage[]; hasMore: boolean }
  | { t: 'conversation-history-around'; conversationId: string; msgId: number; messages: ChatMessage[]; hasMoreBefore: boolean; hasMoreAfter: boolean }
  | { t: 'conversation-deleted'; conversationId: string }
  | { t: 'participant-joined'; participant: Participant }
  | { t: 'participant-updated'; participant: Participant }
  | { t: 'participant-left'; id: string }
  | { t: 'reaction'; id: string; emoji: ReactionEmoji }
  | { t: 'message-search-results'; query: string; conversationId?: string; results: SearchResult[] }
  | { t: 'chat'; message: ChatMessage }
  | { t: 'chat-deleted'; conversationId: string; msgId: number }
  | { t: 'chat-edited'; message: ChatMessage }
  | { t: 'chat-reaction-updated'; conversationId: string; msgId: number; emoji: ReactionEmoji; userIds: string[] }
  | { t: 'chat-attachment-added'; conversationId: string; msgId: number; attachment: ChatAttachment }
  | { t: 'user-online'; userId: string }
  | { t: 'user-offline'; userId: string }
  | { t: 'user-registered'; user: PublicUser }
  | { t: 'user-deleted'; userId: string }
  | ({ t: 'storage-usage' } & StorageUsage)
  | { t: 'error'; code: string; message: string }
  | { t: 'pong' }
  | { t: 'server-restart' };

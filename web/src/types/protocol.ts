
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
  voiceChannelId: string | null;
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
  channelId: string;
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
  channelId: string;
  channelName: string;
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
  | { t: 'join'; id?: string; token?: string }
  | { t: 'profile'; avatar: string; avatarColor: string; displayName: string; banner: string; bio: string; profileLinks: string[] }
  | { t: 'reaction'; emoji: ReactionEmoji }
  | { t: 'deafened'; value: boolean }
  | { t: 'mic-state'; activated: boolean; muted: boolean }
  | { t: 'camera'; on: boolean }
  | { t: 'screen-share'; on: boolean }
  | { t: 'speaking'; value: boolean }
  | { t: 'channel-open'; channelId: string }
  | { t: 'load-more-messages'; channelId: string; beforeMsgId: number }
  | { t: 'load-messages-around'; channelId: string; msgId: number }
  | { t: 'message-search'; query: string; channelId?: string }
  | { t: 'chat'; channelId: string; text: string; replyTo?: number }
  | { t: 'chat-delete'; msgId: number }
  | { t: 'chat-edit'; msgId: number; text: string }
  | { t: 'chat-react'; msgId: number; emoji: ReactionEmoji }
  | { t: 'category-create'; name: string }
  | { t: 'category-delete'; categoryId: string }
  | { t: 'category-rename'; categoryId: string; name: string }
  | { t: 'channel-create'; categoryId: string; name: string; type?: 'text' | 'voice' }
  | { t: 'channel-delete'; channelId: string }
  | { t: 'channel-rename'; channelId: string; name: string }
  | { t: 'user-delete'; userId: string }
  | { t: 'categories-reorder'; orderedIds: string[] }
  | { t: 'channels-reorder'; categoryId: string; orderedIds: string[] }
  | { t: 'call-event'; kind: 'joined' | 'screenshare' }
  | { t: 'voice-join'; channelId: string }
  | { t: 'voice-leave' }
  | { t: 'voice-kick'; participantId: string }
  | { t: 'leave' }
  | { t: 'ping' };

export type ServerMessage =
  | {
      t: 'welcome'; id: string; token: string;
      userId: string; name: string; displayName: string; avatar: string; avatarColor: string;
      banner: string; bio: string; profileLinks: string[]; role: 'user' | 'admin';
      maxParticipants: number; participants: Participant[];
      categories: Category[]; users: PublicUser[]; onlineUserIds: string[];
      storageUsage: StorageUsage;
      livekitUrl: string;
    }
  | { t: 'voice-token'; channelId: string; livekitUrl: string; livekitToken: string }
  | { t: 'participant-joined'; participant: Participant }
  | { t: 'participant-updated'; participant: Participant }
  | { t: 'participant-left'; id: string }
  | { t: 'reaction'; id: string; emoji: ReactionEmoji }
  | { t: 'channel-history'; channelId: string; messages: ChatMessage[]; hasMore: boolean }
  | { t: 'channel-history-more'; channelId: string; messages: ChatMessage[]; hasMore: boolean }
  | { t: 'channel-history-around'; channelId: string; msgId: number; messages: ChatMessage[]; hasMoreBefore: boolean; hasMoreAfter: boolean }
  | { t: 'message-search-results'; query: string; channelId?: string; results: SearchResult[] }
  | { t: 'chat'; message: ChatMessage }
  | { t: 'chat-deleted'; channelId: string; msgId: number }
  | { t: 'chat-edited'; message: ChatMessage }
  | { t: 'chat-reaction-updated'; channelId: string; msgId: number; emoji: ReactionEmoji; userIds: string[] }
  | { t: 'chat-attachment-added'; channelId: string; msgId: number; attachment: ChatAttachment }
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

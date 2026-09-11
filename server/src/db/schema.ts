import { pgTable, text, varchar, timestamp, integer, bigint, jsonb, serial, uniqueIndex, index, customType } from 'drizzle-orm/pg-core';
import { sql, type SQL } from 'drizzle-orm';

// Postgres tsvector has no first-class drizzle column type — customType
// just needs to know its SQL type name; the actual value is always
// computed by Postgres itself (see messages.searchVector below), never
// written from the app, so there's no fromDriver/toDriver to define.
const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' });

/** An account. `username` is immutable and the room's unique login/mention
 * handle. `displayName` is the free-form, non-unique name shown everywhere
 * else — '' means "not set", every read site falls back to `username` (see
 * auth/users.ts#resolveDisplayName). */
export const users = pgTable('users', {
  // app-generated via crypto.randomUUID() instead of gen_random_uuid() to
  // avoid depending on the pgcrypto extension being installed.
  id: text('id').primaryKey(),
  username: varchar('username', { length: 20 }).notNull(),
  displayName: varchar('display_name', { length: 32 }).notNull().default(''),
  passwordHash: text('password_hash').notNull(),
  avatar: text('avatar').notNull().default(''),
  avatarColor: varchar('avatar_color', { length: 32 }).notNull().default('blurple'),
  banner: text('banner').notNull().default(''),
  bio: text('bio').notNull().default(''),
  profileLinks: jsonb('profile_links').$type<string[]>().notNull().default([]),
  role: varchar('role', { length: 16 }).notNull().default('user'), // 'user' | 'admin'
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // CASE-INSENSITIVE uniqueness: "Lune" and "lune" are the same person. The
  // chosen spelling is stored in the column; uniqueness lives in an index
  // on lower(username) — every username lookup must use that SAME
  // expression (see auth/users.ts), or Postgres won't use this index.
  uniqueIndex('users_username_lower_key').on(sql`lower(${t.username})`),
]);

/** Login session. The key is the sha256 of the cookie value, never the raw
 * value — a DB leak alone can't be replayed as a session. */
export const sessions = pgTable('sessions', {
  tokenHash: text('token_hash').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
}, (t) => [
  index('sessions_user_id_idx').on(t.userId),
]);

/** A messaging conversation. `direct` rows represent a one-to-one DM and
 * use `dmKey` (sorted user ids) to guarantee there is only one conversation
 * per pair. `group` rows are admin-created spaces that can also host calls. */
export const conversations = pgTable('conversations', {
  id: text('id').primaryKey(),
  type: varchar('type', { length: 12 }).notNull(), // 'direct' | 'group'
  title: varchar('title', { length: 80 }).notNull().default(''),
  avatar: text('avatar').notNull().default(''),
  createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
  dmKey: text('dm_key'),
  lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('conversations_dm_key_unique').on(t.dmKey),
  index('conversations_type_idx').on(t.type),
]);

/** Membership for both DMs and groups. DMs always have two rows; groups have
 * the admin creator as `owner` and selected users as `member`. */
export const conversationMembers = pgTable('conversation_members', {
  conversationId: text('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: varchar('role', { length: 16 }).notNull().default('member'), // 'owner' | 'admin' | 'member'
  lastReadMessageId: integer('last_read_message_id'),
  // set when this member "closes" a direct conversation (Discord-style —
  // leaves their own history list without deleting anything). listForUser
  // hides it again until a message newer than this arrives. Never used for
  // groups (those use conversation_members row deletion = actually leaving).
  hiddenAt: timestamp('hidden_at', { withTimezone: true }),
  joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('conversation_members_conversation_user_key').on(t.conversationId, t.userId),
  index('conversation_members_user_id_idx').on(t.userId),
  index('conversation_members_conversation_id_idx').on(t.conversationId),
]);

/** Chat message, now persisted (used to live only in memory, lost on
 * every restart). `authorId` is SET NULL if the account is later deleted.
 * Mutable profile data (display name/avatar/color) intentionally lives only
 * on `users`; chat rows resolve it with a join when they are read, so a
 * profile change updates the whole history without rewriting messages. */
export const messages = pgTable('messages', {
  id: serial('id').primaryKey(),
  conversationId: text('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  authorId: text('author_id').references(() => users.id, { onDelete: 'set null' }),
  text: text('text').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  editedAt: timestamp('edited_at', { withTimezone: true }),
  replyTo: jsonb('reply_to'),
  reactions: jsonb('reactions').notNull().default({}),
  // Postgres computes/maintains this itself (GENERATED ALWAYS AS ... STORED)
  // on every insert/update of `text` — never set from the app. 'portuguese'
  // config for stemming (a search for "mensagem" should also find
  // "mensagens"); see modules/chat.ts#handleMessageSearch for the matching
  // query side.
  searchVector: tsvector('search_vector').generatedAlwaysAs((): SQL => sql`to_tsvector('portuguese', ${messages.text})`),
}, (t) => [
  index('messages_conversation_id_idx').on(t.conversationId),
  index('messages_search_vector_idx').using('gin', t.searchVector),
]);

/** A file on disk (config.UPLOAD_DIR) — either a message attachment or an
 * avatar; both reuse the same table/folder/serving route
 * (attachments.ts). `messageId` NULL is what distinguishes an avatar from
 * a chat attachment (never backfilled later) — that's why getUsage()
 * (Settings quota) filters on `messageId IS NOT NULL`; avatars don't count
 * toward it (one per account, always replacing the previous, see
 * deleteAvatarFile). `id` is an app-generated uuid reused as the on-disk
 * filename — Postgres doesn't know that, so deleting this row (directly or
 * via CASCADE from messages/conversations) NEVER deletes the file by itself;
 * that's on the code that deletes the row (see
 * deleteForMessage/deleteForConversation/deleteAvatarFile). */
export const attachments = pgTable('attachments', {
  id: text('id').primaryKey(),
  messageId: integer('message_id').references(() => messages.id, { onDelete: 'cascade' }),
  fileName: text('file_name').notNull(),
  mimeType: text('mime_type').notNull(),
  // bigint (not integer): the attachment cap is 2GiB (MAX_ATTACHMENT_BYTES),
  // which overflows Postgres's int4 (max 2,147,483,647) by 1 byte. mode:
  // 'number' is safe here — a real file size never gets close to
  // Number.MAX_SAFE_INTEGER.
  size: bigint('size', { mode: 'number' }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('attachments_message_id_idx').on(t.messageId),
]);

export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type ConversationMember = typeof conversationMembers.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Attachment = typeof attachments.$inferSelect;

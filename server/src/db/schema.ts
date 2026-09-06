import { pgTable, text, varchar, timestamp, integer, bigint, jsonb, serial, uniqueIndex, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/** An account. `username` is the display name (immutable after
 * registration) — there's no separate nickname, so it's also the room's
 * visible uniqueness key. */
export const users = pgTable('users', {
  // app-generated via crypto.randomUUID() instead of gen_random_uuid() to
  // avoid depending on the pgcrypto extension being installed.
  id: text('id').primaryKey(),
  username: varchar('username', { length: 20 }).notNull(),
  passwordHash: text('password_hash').notNull(),
  avatar: text('avatar').notNull().default(''),
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

/** A category of text channels (Discord-style) — admin-only create/
 * delete. `position` decides display order; reordering reindexes the
 * whole list (see channels.ts), no fractional index. Deleting only works
 * if empty (RESTRICT) — there's no "what to do with orphaned channels" to
 * decide, the admin deletes the channels first. */
export const categories = pgTable('categories', {
  id: text('id').primaryKey(),
  name: varchar('name', { length: 60 }).notNull(),
  position: integer('position').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** A channel inside a category — 'text' or 'voice' (see channels.ts for
 * the "at least one voice channel" rule). Deleting a text channel CASCADEs
 * its messages (chat.ts) — that's how "delete the channel deletes
 * everything from the DB forever" works, without deleting row by row. */
export const channels = pgTable('channels', {
  id: text('id').primaryKey(),
  categoryId: text('category_id').notNull().references(() => categories.id, { onDelete: 'restrict' }),
  name: varchar('name', { length: 60 }).notNull(),
  type: varchar('type', { length: 10 }).notNull().default('text'), // 'text' | 'voice'
  position: integer('position').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('channels_category_id_idx').on(t.categoryId),
]);

/** Chat message, now persisted (used to live only in memory, lost on
 * every restart). `authorId` is SET NULL if the account is later deleted —
 * authorName/authorAvatar stay frozen on the row, so history remains
 * readable even without the author existing. `replyTo`/`reactions` keep
 * the same frozen shape the protocol already used. */
export const messages = pgTable('messages', {
  id: serial('id').primaryKey(),
  channelId: text('channel_id').notNull().references(() => channels.id, { onDelete: 'cascade' }),
  authorId: text('author_id').references(() => users.id, { onDelete: 'set null' }),
  authorName: varchar('author_name', { length: 20 }).notNull(),
  authorAvatar: text('author_avatar').notNull().default(''),
  text: text('text').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  editedAt: timestamp('edited_at', { withTimezone: true }),
  replyTo: jsonb('reply_to'),
  reactions: jsonb('reactions').notNull().default({}),
}, (t) => [
  // History always filters by channel and walks newest ids first. Postgres
  // can scan this btree backwards for ORDER BY id DESC.
  index('messages_channel_id_id_idx').on(t.channelId, t.id),
]);

/** A file on disk (config.UPLOAD_DIR) — either a message attachment or an
 * avatar; both reuse the same table/folder/serving route
 * (attachments.ts). `messageId` NULL is what distinguishes an avatar from
 * a chat attachment (never backfilled later) — that's why getUsage()
 * (Settings quota) filters on `messageId IS NOT NULL`; avatars don't count
 * toward it (one per account, always replacing the previous, see
 * deleteAvatarFile). `id` is an app-generated uuid reused as the on-disk
 * filename — Postgres doesn't know that, so deleting this row (directly or
 * via CASCADE from messages/channels) NEVER deletes the file by itself;
 * that's on the code that deletes the row (see
 * deleteForMessage/deleteForChannel/deleteAvatarFile). */
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
export type Category = typeof categories.$inferSelect;
export type Channel = typeof channels.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Attachment = typeof attachments.$inferSelect;

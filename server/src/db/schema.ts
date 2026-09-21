import { pgTable, text, varchar, timestamp, integer, bigint, jsonb, serial, boolean, uniqueIndex, index, primaryKey, check, customType } from 'drizzle-orm/pg-core';
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
  // Nullable for accounts created before email recovery was introduced.
  email: varchar('email', { length: 320 }),
  displayName: varchar('display_name', { length: 32 }).notNull().default(''),
  passwordHash: text('password_hash').notNull(),
  avatar: text('avatar').notNull().default(''),
  // Static first-frame JPEG generated alongside an animated avatar/banner
  // (GIF/animated WebP) — '' means the current avatar/banner isn't animated
  // (or predates this column). Lets the call UI freeze on this instead of
  // the live animation until the person actually speaks (see Tile.tsx).
  avatarPoster: text('avatar_poster').notNull().default(''),
  avatarColor: varchar('avatar_color', { length: 32 }).notNull().default('blurple'),
  banner: text('banner').notNull().default(''),
  bannerPoster: text('banner_poster').notNull().default(''),
  bio: text('bio').notNull().default(''),
  profileLinks: jsonb('profile_links').$type<string[]>().notNull().default([]),
  role: varchar('role', { length: 16 }).notNull().default('user'), // 'user' | 'admin'
  // 'active' | 'suspended'. A suspended account can't hold a session at all
  // (resolveSession returns null) — see modules/admin/adminUsers.ts.
  status: varchar('status', { length: 16 }).notNull().default('active'),
  statusReason: text('status_reason').notNull().default(''),
  statusChangedAt: timestamp('status_changed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('users_status_idx').on(t.status),
  index('users_created_at_id_idx').on(t.createdAt, t.id),
  // CASE-INSENSITIVE uniqueness: "Lune" and "lune" are the same person. The
  // chosen spelling is stored in the column; uniqueness lives in an index
  // on lower(username) — every username lookup must use that SAME
  // expression (see auth/users.ts), or Postgres won't use this index.
  uniqueIndex('users_username_lower_key').on(sql`lower(${t.username})`),
  uniqueIndex('users_email_lower_key').on(sql`lower(${t.email})`),
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

/** Short-lived one-time codes for account recovery and email changes. Only
 * the hash is stored, so a database read cannot be used to recover a code. */
export const authCodes = pgTable('auth_codes', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  purpose: varchar('purpose', { length: 32 }).notNull(), // 'password_reset' | 'email_change'
  email: varchar('email', { length: 320 }).notNull(),
  codeHash: text('code_hash').notNull(),
  attempts: integer('attempts').notNull().default(0),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('auth_codes_user_purpose_idx').on(t.userId, t.purpose),
  index('auth_codes_email_purpose_idx').on(t.email, t.purpose),
]);

/** A messaging conversation. `direct` rows represent a one-to-one DM and
 * use `dmKey` (sorted user ids) to guarantee there is only one conversation
 * per pair. `group` rows are admin-created spaces that can also host calls.
 *
 * Three separate timestamps, deliberately not conflated (see
 * modules/conversations.ts#touchConversation / #recordConversationActivity):
 * `lastMessageAt` moves ONLY when a genuinely NEW message is sent — it's
 * what sorts the sidebar (listForUser) and what makes an otherwise-empty
 * direct conversation start showing / a closed one resurface, so an edit or
 * delete of an OLD message must never touch it (that used to bump a
 * conversation to the top of everyone's sidebar for no new activity).
 * `updatedAt` is the conversation ROW itself changing (rename/avatar via
 * handleGroupUpdate) — unrelated to message activity. `lastActivityAt` is
 * the broad bookkeeping timestamp: any chat activity at all (send, edit,
 * delete) — not read by any sort/visibility rule today, kept for future
 * "last touched" needs (moderation, cleanup) without it silently doubling
 * as the sort key the way `lastMessageAt` used to. */
export const conversations = pgTable('conversations', {
  id: text('id').primaryKey(),
  type: varchar('type', { length: 12 }).notNull(), // 'direct' | 'group'
  title: varchar('title', { length: 80 }).notNull().default(''),
  avatar: text('avatar').notNull().default(''),
  createdBy: text('created_by').references(() => users.id, { onDelete: 'set null' }),
  dmKey: text('dm_key'),
  lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
  lastActivityAt: timestamp('last_activity_at', { withTimezone: true }),
  // 'active' | 'suspended' — a suspended conversation is still listed to its
  // members but every membership-gated read/write treats it as no access
  // (conversationsRepository.ts#conversationExistsForUser).
  status: varchar('status', { length: 16 }).notNull().default('active'),
  statusReason: text('status_reason').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('conversations_dm_key_unique').on(t.dmKey),
  index('conversations_type_idx').on(t.type),
  index('conversations_type_status_created_idx').on(t.type, t.status, t.createdAt, t.id),
]);

/** Membership for both DMs and groups. DMs always have two rows, both
 * `member` (a DM has no owner). Groups have the creator as `owner` and
 * everyone else as `member` — `'admin'` was never actually assigned
 * anywhere and has been dropped from the type. */
export const conversationMembers = pgTable('conversation_members', {
  conversationId: text('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: varchar('role', { length: 16 }).notNull().default('member'), // 'owner' | 'member'
  lastReadMessageId: integer('last_read_message_id'),
  // set when this member "closes" a direct conversation (Discord-style —
  // leaves their own history list without deleting anything). listForUser
  // hides it again until a message newer than this arrives. Never used for
  // groups (those use conversation_members row deletion = actually leaving).
  hiddenAt: timestamp('hidden_at', { withTimezone: true }),
  // per-member pin (works for both direct and group) — purely a personal
  // sidebar preference, doesn't touch the conversation itself or anyone
  // else's row. Pinned conversations sort first in listForUser.
  pinnedAt: timestamp('pinned_at', { withTimezone: true }),
  joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('conversation_members_conversation_user_key').on(t.conversationId, t.userId),
  index('conversation_members_user_id_idx').on(t.userId),
  index('conversation_members_conversation_id_idx').on(t.conversationId),
  // at most one owner per conversation — DMs never set role='owner' at all,
  // so this only ever constrains groups. Application logic (conversations.ts)
  // already only ever assigns exactly one owner at creation, but the real
  // guarantee needs to live in the database, not just in code that could
  // have a bug later.
  uniqueIndex('conversation_members_one_owner_idx').on(t.conversationId).where(sql`${t.role} = 'owner'`),
]);

/** A friend relationship between two accounts — one row per canonical pair
 * (`userLowId < userHighId`, a deterministic ordering of the ids so the
 * same pair can never get two rows regardless of who requested). Consent is
 * two-sided: `requestedBy` is whichever side is still waiting on the other
 * while `status = 'pending'`. `version` guards against a stale accept
 * racing a newer request (see modules/friendships in a later etapa) — the
 * column exists now so the DB invariant is there before any handler writes
 * to it. */
export const friendships = pgTable('friendships', {
  id: text('id').primaryKey(),
  userLowId: text('user_low_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  userHighId: text('user_high_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  requestedBy: text('requested_by').notNull().references(() => users.id, { onDelete: 'cascade' }),
  status: varchar('status', { length: 16 }).notNull().default('pending'), // 'pending' | 'accepted' | 'declined' | 'cancelled' | 'removed'
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  respondedAt: timestamp('responded_at', { withTimezone: true }),
  retryAfter: timestamp('retry_after', { withTimezone: true }),
}, (t) => [
  uniqueIndex('friendships_pair_key').on(t.userLowId, t.userHighId),
  index('friendships_user_high_id_idx').on(t.userHighId),
  index('friendships_status_idx').on(t.status),
  check('friendships_pair_order_check', sql`${t.userLowId} < ${t.userHighId}`),
  check('friendships_requester_in_pair_check', sql`${t.requestedBy} = ${t.userLowId} OR ${t.requestedBy} = ${t.userHighId}`),
  check('friendships_status_check', sql`${t.status} IN ('pending','accepted','declined','cancelled','removed')`),
]);

/** Directional block — no surrogate id, same reasoning as
 * `messageReactions`: nothing ever references a single block row on its
 * own. The two sides are independent: `blockerId` unblocking doesn't touch
 * whatever `blockedId` may have done on their own row. */
export const userBlocks = pgTable('user_blocks', {
  blockerId: text('blocker_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  blockedId: text('blocked_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.blockerId, t.blockedId] }),
  index('user_blocks_blocked_id_idx').on(t.blockedId), // "who blocked me"
  check('user_blocks_different_users_check', sql`${t.blockerId} <> ${t.blockedId}`),
]);

/** A pending/resolved invitation to a group — a pending invite is NOT
 * membership (no history, call access, search, or mentions until accepted).
 * `conversationId` always points at a `group` conversation, never a DM.
 * Cascades when the group itself is deleted — an invite to a group that no
 * longer exists is meaningless, and `messages.groupInvitationId` (below)
 * is what keeps the DM card alive as a tombstone instead of disappearing. */
export const groupInvitations = pgTable('group_invitations', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  inviterId: text('inviter_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  inviteeId: text('invitee_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  status: varchar('status', { length: 16 }).notNull().default('pending'), // 'pending' | 'accepted' | 'declined' | 'revoked' | 'expired'
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  // legacy: invitations no longer expire (null); old rows may still carry one
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  respondedAt: timestamp('responded_at', { withTimezone: true }),
}, (t) => [
  // at most one PENDING invite per (group, invitee) — a re-invite after
  // decline/expiry resolves the old row first, doesn't get blocked here.
  uniqueIndex('group_invitations_pending_unique').on(t.conversationId, t.inviteeId).where(sql`${t.status} = 'pending'`),
  index('group_invitations_invitee_status_idx').on(t.inviteeId, t.status),
  index('group_invitations_conversation_id_idx').on(t.conversationId),
  check('group_invitations_status_check', sql`${t.status} IN ('pending','accepted','declined','revoked','expired')`),
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
  kind: varchar('kind', { length: 16 }).notNull().default('text'), // 'text' | 'group_invite'
  // Points at the invitation this card represents. SET NULL (not cascade):
  // if the invitation row is gone (e.g. the group got deleted, cascading
  // down to group_invitations), the card stays in the DM as a tombstone —
  // "Convite indisponível" — instead of vanishing.
  groupInvitationId: text('group_invitation_id').references(() => groupInvitations.id, { onDelete: 'set null' }),
  // Postgres computes/maintains this itself (GENERATED ALWAYS AS ... STORED)
  // on every insert/update of `text` — never set from the app. 'portuguese'
  // config for stemming (a search for "mensagem" should also find
  // "mensagens"); see modules/chat.ts#handleMessageSearch for the matching
  // query side.
  searchVector: tsvector('search_vector').generatedAlwaysAs((): SQL => sql`to_tsvector('portuguese', ${messages.text})`),
}, (t) => [
  index('messages_conversation_id_idx').on(t.conversationId),
  index('messages_search_vector_idx').using('gin', t.searchVector),
  index('messages_group_invitation_id_idx').on(t.groupInvitationId),
  check('messages_kind_reference_check', sql`(${t.kind} = 'text' AND ${t.groupInvitationId} IS NULL) OR (${t.kind} = 'group_invite')`),
]);

/** One row per (message, user, emoji) — a user can react to the same
 * message with several DIFFERENT emoji at once, but only once per emoji
 * (that's the toggle in modules/chat.ts#handleChatReact: reacting again
 * with the same emoji removes this exact row). No surrogate id: nothing
 * ever references a single reaction row on its own — it's only ever
 * inserted, deleted, or listed grouped by message/emoji — so the natural
 * key IS the primary key (contrast with attachments.id, which exists
 * because a file has its own on-disk identity). Both FKs cascade: a
 * reaction with no message or no reactor left means nothing, unlike
 * messages.authorId (set null) which preserves history on account
 * deletion — there's no "ghost reaction" worth keeping around. */
export const messageReactions = pgTable('message_reactions', {
  messageId: integer('message_id').notNull().references(() => messages.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  emoji: varchar('emoji', { length: 16 }).notNull(), // same cap as isSingleEmoji, modules/emoji.ts
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.messageId, t.userId, t.emoji] }),
  index('message_reactions_message_id_idx').on(t.messageId),
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
 * deleteForMessage/deleteForConversation/deleteAvatarFile). A generated
 * thumbnail is a THIRD kind of row: `messageId` set to the same message as
 * the attachment it previews (`isThumbnail: true`), not null — see
 * `thumbId`/`isThumbnail` below for why. */
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
  // Points at another row's `id` in THIS same table — the resized preview
  // generated for an image attachment (see attachments.ts#generateThumbnail).
  // No FK: it's a soft, optional link, same spirit as the nullable
  // `messageId` above. Null when there's no thumbnail (non-image, animation
  // too small to bother, or generation failed — never fatal to the upload).
  thumbId: text('thumb_id'),
  // True ONLY on the thumbnail row itself (messageId set to the SAME
  // message as its parent, on purpose — see attachments.ts#generateThumbnail
  // for why: it has to ride the parent's cascade-delete/quota-counting,
  // but must NOT show up as a second, duplicate attachment of that message).
  // Every query that lists "this message's attachments" must filter
  // isThumbnail = false (see getByMessageIds, modules/media.ts).
  isThumbnail: boolean('is_thumbnail').notNull().default(false),
}, (t) => [
  index('attachments_message_id_idx').on(t.messageId),
]);

/** The recipient's inbox/read-state for a social event — scoped for now to
 * the resources that exist this etapa (friend requests, group invitations).
 * Typed FKs, not a generic JSON blob, so referential integrity is real.
 * `dedupeKey` is deterministic per event (e.g.
 * `friend_request:<friendshipId>:<version>`) so a retried outbox write
 * can't create a duplicate notification. "Read" only means seen — it does
 * NOT mean accepted; the friendship/invitation row is the actual source of
 * truth for that. */
export const notifications = pgTable('notifications', {
  id: text('id').primaryKey(),
  recipientId: text('recipient_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  kind: varchar('kind', { length: 32 }).notNull(), // 'friend_request' | 'friend_accepted' | 'group_invitation'
  friendshipId: text('friendship_id').references(() => friendships.id, { onDelete: 'cascade' }),
  groupInvitationId: text('group_invitation_id').references(() => groupInvitations.id, { onDelete: 'cascade' }),
  dedupeKey: text('dedupe_key').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  readAt: timestamp('read_at', { withTimezone: true }),
}, (t) => [
  uniqueIndex('notifications_dedupe_key_unique').on(t.dedupeKey),
  index('notifications_recipient_created_idx').on(t.recipientId, t.createdAt),
  index('notifications_recipient_unread_idx').on(t.recipientId).where(sql`${t.readAt} IS NULL`),
  check('notifications_kind_reference_check', sql`
    (${t.kind} IN ('friend_request','friend_accepted') AND ${t.friendshipId} IS NOT NULL AND ${t.groupInvitationId} IS NULL)
    OR (${t.kind} = 'group_invitation' AND ${t.groupInvitationId} IS NOT NULL AND ${t.friendshipId} IS NULL)
  `),
]);

/** Transactional outbox: the same commit that changes durable state (e.g.
 * accepts a friend request) writes the event to deliver here, instead of
 * emitting directly and risking a commit that succeeds while the socket
 * emit is lost. A worker (introduced in a later etapa) delivers with
 * dedup/retry. `payload` is a minimal reference (ids only) — it must never
 * freeze a permission snapshot; the worker re-validates audience/authorization
 * at delivery time, not at write time. */
export const outboxEvents = pgTable('outbox_events', {
  id: text('id').primaryKey(),
  type: varchar('type', { length: 64 }).notNull(), // e.g. 'friend_request_created', 'group_invitation_created'
  audienceUserId: text('audience_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  payload: jsonb('payload').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp('processed_at', { withTimezone: true }),
  attempts: integer('attempts').notNull().default(0),
}, (t) => [
  index('outbox_events_unprocessed_idx').on(t.createdAt).where(sql`${t.processedAt} IS NULL`),
  index('outbox_events_audience_user_id_idx').on(t.audienceUserId),
]);

export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type AuthCode = typeof authCodes.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type ConversationMember = typeof conversationMembers.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Attachment = typeof attachments.$inferSelect;
export type MessageReaction = typeof messageReactions.$inferSelect;
export type Friendship = typeof friendships.$inferSelect;
export type UserBlock = typeof userBlocks.$inferSelect;
export type GroupInvitation = typeof groupInvitations.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type OutboxEvent = typeof outboxEvents.$inferSelect;

/** Append-only record of administrative actions. No foreign keys on purpose:
 * the trail must outlive the account or group it is about (and the admin who
 * acted), so actor/target are stored as ids plus a label snapshot. The
 * application only ever INSERTs here. `detail` never carries passwords,
 * cookies, tokens or conversation bodies. */
export const adminAuditLogs = pgTable('admin_audit_logs', {
  id: text('id').primaryKey(),
  actorId: text('actor_id'),
  actorLabel: text('actor_label').notNull().default(''),
  action: varchar('action', { length: 48 }).notNull(),
  targetType: varchar('target_type', { length: 16 }).notNull(), // 'user' | 'group' | 'message' | 'report' | 'system'
  targetId: text('target_id').notNull().default(''),
  targetLabel: text('target_label').notNull().default(''),
  reason: text('reason').notNull().default(''),
  result: varchar('result', { length: 16 }).notNull().default('ok'), // 'ok' | 'failed'
  detail: jsonb('detail').$type<Record<string, unknown>>().notNull().default({}),
  requestId: text('request_id').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('admin_audit_created_id_idx').on(t.createdAt, t.id),
  index('admin_audit_actor_idx').on(t.actorId, t.createdAt),
  index('admin_audit_target_idx').on(t.targetType, t.targetId, t.createdAt),
  index('admin_audit_action_idx').on(t.action, t.createdAt),
  check('admin_audit_result_check', sql`${t.result} IN ('ok','failed')`),
]);

/** A user's report about an account, a group or a message. `snapshot` keeps
 * the only evidence there is — for a message, its text at the moment of the
 * report (capped) — so the case survives the author editing or deleting it;
 * an admin never gets to read anything else in the conversation. The reporter
 * is never shown to the reported account. */
export const reports = pgTable('reports', {
  id: text('id').primaryKey(),
  reporterId: text('reporter_id').references(() => users.id, { onDelete: 'set null' }),
  targetType: varchar('target_type', { length: 16 }).notNull(), // 'user' | 'group' | 'message'
  targetId: text('target_id').notNull(),
  targetLabel: text('target_label').notNull().default(''),
  category: varchar('category', { length: 24 }).notNull(),
  details: text('details').notNull().default(''),
  status: varchar('status', { length: 16 }).notNull().default('open'), // 'open' | 'reviewing' | 'resolved' | 'dismissed'
  assigneeId: text('assignee_id').references(() => users.id, { onDelete: 'set null' }),
  resolution: varchar('resolution', { length: 24 }).notNull().default(''),
  resolutionNote: text('resolution_note').notNull().default(''),
  snapshot: jsonb('snapshot').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
}, (t) => [
  index('reports_status_created_idx').on(t.status, t.createdAt, t.id),
  index('reports_target_idx').on(t.targetType, t.targetId),
  // one live report per reporter and target — a second click is not a second case
  uniqueIndex('reports_open_unique').on(t.reporterId, t.targetType, t.targetId).where(sql`${t.status} IN ('open','reviewing')`),
  check('reports_target_type_check', sql`${t.targetType} IN ('user','group','message')`),
  check('reports_status_check', sql`${t.status} IN ('open','reviewing','resolved','dismissed')`),
]);

/** Record of every correction the legacy-data repair made (docs/plano-rede-social.md
 * §12.2 "registrar todas as correções"). The repair script creates this table
 * itself when it runs BEFORE the migrations; this definition keeps drizzle and the
 * migration history in step. */
export const dataRepairs = pgTable('data_repairs', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull(),
  kind: varchar('kind', { length: 32 }).notNull(),
  targetType: varchar('target_type', { length: 16 }).notNull(),
  targetId: text('target_id').notNull(),
  before: jsonb('before').$type<Record<string, unknown>>().notNull().default({}),
  after: jsonb('after').$type<Record<string, unknown>>().notNull().default({}),
  note: text('note').notNull().default(''),
  needsReview: boolean('needs_review').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('data_repairs_run_idx').on(t.runId),
  index('data_repairs_target_idx').on(t.targetType, t.targetId),
]);

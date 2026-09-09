import { eq, and, desc, asc, lt, gte, sql } from 'drizzle-orm';
import { config } from '../config/env.js';
import { db } from '../db/client.js';
import { messages, channels, users, type Message, type Attachment } from '../db/schema.js';
import { participants, broadcast, send } from '../realtime/participants.js';
import { ALLOWED_REACTIONS } from '../realtime/reactions.js';
import { channelExists } from './channels.js';
import { resolveDisplayName } from './auth/users.js';
import * as attachments from './attachments.js';
import type { AppSocket, HandlerTable, Participant } from '../types.js';

// Deleting a channel (modules/channels.ts) CASCADEs here.
//
// `ChatMessage.id` (the `id` field) holds the account's USERID, not the
// connection id (`p.id`) — messages persist across reconnects, so "is this
// my message?" and "did I react?" must survive tab/session changes too.
// The client compares against `state.me.userId`, not `state.me.id`.

const REPLY_PREVIEW_LEN = 120;
const DELETED_AUTHOR_NAME = 'Usuario apagado';
// split of CHAT_HISTORY_LIMIT for handleLoadMessagesAround — half before
// the target, half from (and including) it.
const AROUND_BEFORE_LIMIT = Math.floor(config.CHAT_HISTORY_LIMIT / 2);
const AROUND_AFTER_LIMIT = config.CHAT_HISTORY_LIMIT - AROUND_BEFORE_LIMIT;

interface ReplyRef {
  msgId: number;
  authorId: string | null;
  text: string;
  attachmentCount?: number;
}

interface ChatMessagePayload {
  msgId: number;
  channelId: string;
  id: string | null;
  name: string;
  avatar: string;
  text: string;
  ts: number;
  editedAt?: number;
  replyTo?: ReplyRef;
  reactions?: Record<string, string[]>;
  attachments?: { id: string; name: string; mime: string; size: number }[];
}

interface MessageWithAuthor {
  id: number;
  channelId: string;
  authorId: string | null;
  authorUsername: string | null;
  authorDisplayName: string | null;
  authorAvatar: string | null;
  text: string;
  createdAt: Date;
  editedAt: Date | null;
  replyTo: unknown;
  reactions: unknown;
}

function sanitizeChatText(text: unknown): string {
  return String(text == null ? '' : text).trim().slice(0, config.MAX_CHAT_LEN);
}

const messageWithAuthorSelect = {
  id: messages.id,
  channelId: messages.channelId,
  authorId: messages.authorId,
  authorUsername: users.username,
  authorDisplayName: users.displayName,
  authorAvatar: users.avatar,
  text: messages.text,
  createdAt: messages.createdAt,
  editedAt: messages.editedAt,
  replyTo: messages.replyTo,
  reactions: messages.reactions,
};

function rowWithParticipant(row: Message, participant: Participant): MessageWithAuthor {
  return {
    id: row.id,
    channelId: row.channelId,
    authorId: row.authorId,
    authorUsername: participant.name,
    authorDisplayName: participant.displayName,
    authorAvatar: participant.avatar,
    text: row.text,
    createdAt: row.createdAt,
    editedAt: row.editedAt,
    replyTo: row.replyTo,
    reactions: row.reactions,
  };
}

function authorNameFor(row: MessageWithAuthor): string {
  return row.authorUsername
    ? resolveDisplayName(row.authorDisplayName ?? '', row.authorUsername)
    : DELETED_AUTHOR_NAME;
}

function normalizeReplyRef(raw: unknown): ReplyRef | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  const msgId = Number(obj.msgId);
  if (!Number.isFinite(msgId)) return undefined;
  const ref: ReplyRef = {
    msgId,
    authorId: typeof obj.authorId === 'string' && obj.authorId ? obj.authorId : null,
    text: String(obj.text == null ? '' : obj.text).slice(0, REPLY_PREVIEW_LEN),
  };
  const attachmentCount = Number(obj.attachmentCount);
  if (Number.isFinite(attachmentCount) && attachmentCount > 0) ref.attachmentCount = attachmentCount;
  return ref;
}

/** `attachments` (optional, up to MAX_ATTACHMENTS_PER_MESSAGE) are the raw
 * attachments-table rows — attachments don't live in the messages table,
 * see modules/attachments.ts. */
function rowToMessage(row: MessageWithAuthor, attachments?: Attachment[]): ChatMessagePayload {
  const out: ChatMessagePayload = {
    msgId: row.id,
    channelId: row.channelId,
    id: row.authorId,
    name: authorNameFor(row),
    avatar: row.authorAvatar ?? '',
    text: row.text,
    ts: row.createdAt.getTime(),
  };
  if (row.editedAt) out.editedAt = row.editedAt.getTime();
  const replyTo = normalizeReplyRef(row.replyTo);
  if (replyTo) out.replyTo = replyTo;
  const reactions = row.reactions as Record<string, string[]> | null;
  if (reactions && Object.keys(reactions).length) out.reactions = reactions;
  if (attachments?.length) out.attachments = attachments.map((a) => ({ id: a.id, name: a.fileName, mime: a.mimeType, size: a.size }));
  return out;
}

/** Builds a compact reference to the original message from the client's
 * msgId. It stores the original author's user id, not mutable profile data,
 * so reply previews follow profile changes too. Silently returns undefined
 * if it's gone (deleted) or from another channel, so the reply just carries
 * no reference instead of failing outright. */
async function buildReplyRef(channelId: string, replyToId: unknown): Promise<ReplyRef | undefined> {
  const id = Number(replyToId);
  if (!Number.isFinite(id)) return undefined;
  const [original] = await db
    .select({ id: messages.id, authorId: messages.authorId, text: messages.text })
    .from(messages)
    .where(and(eq(messages.id, id), eq(messages.channelId, channelId)))
    .limit(1);
  if (!original) return undefined;
  const ref: ReplyRef = { msgId: original.id, authorId: original.authorId, text: original.text.slice(0, REPLY_PREVIEW_LEN) };
  // no caption on the original — likely an attachment-only message. Lets
  // the reply reference show "📎 N anexos" instead of a blank snippet.
  if (!ref.text) {
    const attachmentCount = (await attachments.getByMessageIds([original.id])).get(original.id)?.length ?? 0;
    if (attachmentCount > 0) ref.attachmentCount = attachmentCount;
  }
  return ref;
}

/** Client opening a channel (switched tabs, or the first channel on join) —
 * sends the last CHAT_HISTORY_LIMIT messages to just THIS socket (no
 * broadcast). Older pages are fetched on demand via 'load-more-messages'
 * (see handleLoadMoreMessages below). */
async function handleChannelOpen(socket: AppSocket, msg: { channelId?: string }): Promise<void> {
  const p = participants.get(socket.participantId ?? '');
  if (!p || p.socket !== socket) return;
  const channelId = String(msg.channelId || '');
  if (!channelId || !(await channelExists(channelId))) return;
  const rows = await db
    .select(messageWithAuthorSelect)
    .from(messages)
    .leftJoin(users, eq(users.id, messages.authorId))
    .where(eq(messages.channelId, channelId))
    .orderBy(desc(messages.id))
    .limit(config.CHAT_HISTORY_LIMIT);
  rows.reverse();
  // one query for all history messages' attachments, not one per message
  // (N+1) — most have no attachment anyway.
  const attachmentByMessageId = await attachments.getByMessageIds(rows.map((r) => r.id));
  send(socket, {
    t: 'channel-history',
    channelId,
    messages: rows.map((r) => rowToMessage(r, attachmentByMessageId.get(r.id))),
    hasMore: rows.length === config.CHAT_HISTORY_LIMIT,
  });
}

/** Client scrolled to the top of an already-open channel — sends up to
 * CHAT_HISTORY_LIMIT messages older than `beforeMsgId` (the oldest one the
 * client currently has), for it to PREPEND to existing history. */
async function handleLoadMoreMessages(socket: AppSocket, msg: { channelId?: string; beforeMsgId?: unknown }): Promise<void> {
  const p = participants.get(socket.participantId ?? '');
  if (!p || p.socket !== socket) return;
  const channelId = String(msg.channelId || '');
  const beforeMsgId = Number(msg.beforeMsgId);
  if (!channelId || !Number.isFinite(beforeMsgId) || !(await channelExists(channelId))) return;
  const rows = await db
    .select(messageWithAuthorSelect)
    .from(messages)
    .leftJoin(users, eq(users.id, messages.authorId))
    .where(and(eq(messages.channelId, channelId), lt(messages.id, beforeMsgId)))
    .orderBy(desc(messages.id))
    .limit(config.CHAT_HISTORY_LIMIT);
  rows.reverse();
  const attachmentByMessageId = await attachments.getByMessageIds(rows.map((r) => r.id));
  send(socket, {
    t: 'channel-history-more',
    channelId,
    messages: rows.map((r) => rowToMessage(r, attachmentByMessageId.get(r.id))),
    hasMore: rows.length === config.CHAT_HISTORY_LIMIT,
  });
}

/** Search-result click target: a window of history CENTERED on `msgId`,
 * unlike handleChannelOpen ("latest") or handleLoadMoreMessages ("older
 * than X") — the client fully replaces its loaded range for this channel
 * with the result (see RoomProvider.tsx#jumpToMessage), same "recenter"
 * shape as opening a channel, just anchored differently instead of
 * preserving whatever was loaded before. */
async function handleLoadMessagesAround(socket: AppSocket, msg: { channelId?: string; msgId?: unknown }): Promise<void> {
  const p = participants.get(socket.participantId ?? '');
  if (!p || p.socket !== socket) return;
  const channelId = String(msg.channelId || '');
  const msgId = Number(msg.msgId);
  if (!channelId || !Number.isFinite(msgId) || !(await channelExists(channelId))) return;

  // a search result can point at a message deleted since the search ran —
  // without this check the two queries below would just silently return an
  // empty/off window instead of telling the client why.
  const [target] = await db.select({ id: messages.id }).from(messages)
    .where(and(eq(messages.id, msgId), eq(messages.channelId, channelId))).limit(1);
  if (!target) {
    send(socket, { t: 'error', code: 'message-not-found', message: 'Essa mensagem nao existe mais.' });
    return;
  }

  const [beforeRows, afterRows] = await Promise.all([
    db.select(messageWithAuthorSelect).from(messages).leftJoin(users, eq(users.id, messages.authorId))
      .where(and(eq(messages.channelId, channelId), lt(messages.id, msgId)))
      .orderBy(desc(messages.id)).limit(AROUND_BEFORE_LIMIT),
    db.select(messageWithAuthorSelect).from(messages).leftJoin(users, eq(users.id, messages.authorId))
      .where(and(eq(messages.channelId, channelId), gte(messages.id, msgId)))
      .orderBy(asc(messages.id)).limit(AROUND_AFTER_LIMIT),
  ]);
  beforeRows.reverse();
  const rows = [...beforeRows, ...afterRows];
  const attachmentByMessageId = await attachments.getByMessageIds(rows.map((r) => r.id));
  send(socket, {
    t: 'channel-history-around',
    channelId,
    msgId,
    messages: rows.map((r) => rowToMessage(r, attachmentByMessageId.get(r.id))),
    hasMoreBefore: beforeRows.length === AROUND_BEFORE_LIMIT,
    hasMoreAfter: afterRows.length === AROUND_AFTER_LIMIT,
  });
}

/** Full-text search — `channelId` omitted searches every channel, present
 * scopes to just that one. See db/schema.ts#messages.searchVector for the
 * indexed side; websearch_to_tsquery never throws on malformed input
 * (quoted phrases / -exclude / or all work, garbage input just matches
 * nothing), so it's safe to feed raw user text directly into it. */
async function handleMessageSearch(socket: AppSocket, msg: { query?: string; channelId?: string }): Promise<void> {
  const p = participants.get(socket.participantId ?? '');
  if (!p || p.socket !== socket) return;
  const query = String(msg.query || '').trim().slice(0, config.MAX_SEARCH_QUERY_LEN);
  const channelId = msg.channelId ? String(msg.channelId) : undefined;
  if (!query) {
    send(socket, { t: 'message-search-results', query, channelId, results: [] });
    return;
  }
  if (channelId && !(await channelExists(channelId))) return;

  const tsQuery = sql`websearch_to_tsquery('portuguese', ${query})`;
  const rank = sql`ts_rank(${messages.searchVector}, ${tsQuery})`;
  // Private-Use-Area delimiters (never typed in real chat text) instead of
  // HTML — the client splits on them into plain-text/highlight React nodes
  // itself (mirrors ChatMessageText.tsx's own "never build HTML strings"
  // convention), no dangerouslySetInnerHTML anywhere.
  const snippet = sql<string>`ts_headline('portuguese', ${messages.text}, ${tsQuery}, 'StartSel=, StopSel=, MaxFragments=1, MaxWords=20, MinWords=6')`;

  const rows = await db
    .select({ ...messageWithAuthorSelect, channelName: channels.name, snippet })
    .from(messages)
    .innerJoin(channels, eq(channels.id, messages.channelId))
    .leftJoin(users, eq(users.id, messages.authorId))
    .where(and(
      sql`${messages.searchVector} @@ ${tsQuery}`,
      channelId ? eq(messages.channelId, channelId) : undefined,
    ))
    .orderBy(desc(rank), desc(messages.id))
    .limit(config.SEARCH_RESULT_LIMIT);

  send(socket, {
    t: 'message-search-results',
    query,
    channelId,
    results: rows.map((r) => ({
      msgId: r.id,
      channelId: r.channelId,
      channelName: r.channelName,
      id: r.authorId,
      name: authorNameFor(r),
      avatar: r.authorAvatar ?? '',
      ts: r.createdAt.getTime(),
      snippet: r.snippet,
    })),
  });
}

async function handleChat(socket: AppSocket, msg: { channelId?: string; text?: string; replyTo?: unknown }): Promise<void> {
  const p = participants.get(socket.participantId ?? '');
  if (!p || p.socket !== socket) return;
  const channelId = String(msg.channelId || '');
  const text = sanitizeChatText(msg.text);
  if (!channelId || !text || !(await channelExists(channelId))) return;
  const replyTo = await buildReplyRef(channelId, msg.replyTo);
  const [row] = await db.insert(messages).values({
    channelId, authorId: p.userId, text,
    replyTo: replyTo || null,
  }).returning();
  broadcast({ t: 'chat', message: rowToMessage(rowWithParticipant(row!, p)) });
}

/** Only the original author edits — not even admin (Discord-like; admin
 * can only delete, see handleChatDelete). Compared by userId, not
 * connection id — stays "yours" after reconnecting/reloading. */
async function handleChatEdit(socket: AppSocket, msg: { msgId?: unknown; text?: string }): Promise<void> {
  const p = participants.get(socket.participantId ?? '');
  if (!p || p.socket !== socket) return;
  const msgId = Number(msg.msgId);
  const text = sanitizeChatText(msg.text);
  if (!Number.isFinite(msgId) || !text) return;
  const [existing] = await db.select().from(messages).where(eq(messages.id, msgId)).limit(1);
  if (!existing || existing.authorId !== p.userId) return;
  const [updated] = await db.update(messages).set({ text, editedAt: new Date() }).where(eq(messages.id, msgId)).returning();
  // without this, editing a caption on a message WITH an attachment made
  // the attachment disappear for everyone (the client replaces the whole
  // message with what arrives in 'chat-edited', see RoomProvider.tsx).
  const attachment = (await attachments.getByMessageIds([msgId])).get(msgId);
  broadcast({ t: 'chat-edited', message: rowToMessage(rowWithParticipant(updated!, p), attachment) });
}

/** Toggles (not just adds) — reacting again with the same emoji removes
 * your own reaction, Discord-style. */
async function handleChatReact(socket: AppSocket, msg: { msgId?: unknown; emoji?: string }): Promise<void> {
  const p = participants.get(socket.participantId ?? '');
  if (!p || p.socket !== socket) return;
  const msgId = Number(msg.msgId);
  const emoji = String(msg.emoji || '');
  if (!Number.isFinite(msgId) || !ALLOWED_REACTIONS.has(emoji)) return;
  const [existing] = await db.select().from(messages).where(eq(messages.id, msgId)).limit(1);
  if (!existing) return;
  const reactions: Record<string, string[]> = { ...(existing.reactions as Record<string, string[]> | null || {}) };
  const list = reactions[emoji] ? [...reactions[emoji]] : [];
  const idx = list.indexOf(p.userId);
  if (idx === -1) list.push(p.userId); else list.splice(idx, 1);
  if (list.length === 0) delete reactions[emoji]; else reactions[emoji] = list;
  await db.update(messages).set({ reactions }).where(eq(messages.id, msgId));
  broadcast({ t: 'chat-reaction-updated', channelId: existing.channelId, msgId, emoji, userIds: reactions[emoji] || [] });
}

// the original author OR an admin can delete — same split as
// handleChatEdit, except admin gets delete too (never edit, see above).
// "Clear all" no longer exists: deleting the whole channel
// (modules/channels.ts) covers that now.
async function handleChatDelete(socket: AppSocket, msg: { msgId?: unknown }): Promise<void> {
  const p = participants.get(socket.participantId ?? '');
  if (!p || p.socket !== socket) return;
  const msgId = Number(msg.msgId);
  if (!Number.isFinite(msgId)) return;
  const [existing] = await db.select({ channelId: messages.channelId, authorId: messages.authorId }).from(messages).where(eq(messages.id, msgId)).limit(1);
  if (!existing) return;
  if (existing.authorId !== p.userId && p.role !== 'admin') return;
  // delete the file on disk before the row — after the delete below, the
  // attachments row disappears via CASCADE, but nothing would know which
  // file to delete anymore (see modules/attachments.ts).
  await attachments.deleteForMessage(msgId);
  await db.delete(messages).where(eq(messages.id, msgId));
  broadcast({ t: 'chat-deleted', channelId: existing.channelId, msgId });
}

export const handlers: HandlerTable = {
  'channel-open': handleChannelOpen,
  'load-more-messages': handleLoadMoreMessages,
  'load-messages-around': handleLoadMessagesAround,
  'message-search': handleMessageSearch,
  chat: handleChat,
  'chat-delete': handleChatDelete,
  'chat-edit': handleChatEdit,
  'chat-react': handleChatReact,
};

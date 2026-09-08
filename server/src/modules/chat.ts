import { eq, and, desc, lt } from 'drizzle-orm';
import { config } from '../config/env.js';
import { db } from '../db/client.js';
import { messages, users, type Message, type Attachment } from '../db/schema.js';
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

interface ReplyRef {
  msgId: number;
  authorId: string | null;
  text: string;
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
  attachment?: { id: string; name: string; mime: string; size: number };
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
  return {
    msgId,
    authorId: typeof obj.authorId === 'string' && obj.authorId ? obj.authorId : null,
    text: String(obj.text == null ? '' : obj.text).slice(0, REPLY_PREVIEW_LEN),
  };
}

/** `attachment` (optional) is the raw attachments-table row — the
 * attachment itself doesn't live in the messages table, see
 * modules/attachments.ts. */
function rowToMessage(row: MessageWithAuthor, attachment?: Attachment): ChatMessagePayload {
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
  if (attachment) out.attachment = { id: attachment.id, name: attachment.fileName, mime: attachment.mimeType, size: attachment.size };
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
  return { msgId: original.id, authorId: original.authorId, text: original.text.slice(0, REPLY_PREVIEW_LEN) };
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
  chat: handleChat,
  'chat-delete': handleChatDelete,
  'chat-edit': handleChatEdit,
  'chat-react': handleChatReact,
};

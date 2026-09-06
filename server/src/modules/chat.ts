import { eq, and, desc } from 'drizzle-orm';
import { config } from '../config/env.js';
import { db } from '../db/client.js';
import { messages, type Message, type Attachment } from '../db/schema.js';
import { participants, broadcast, send } from '../realtime/participants.js';
import { ALLOWED_REACTIONS } from '../realtime/reactions.js';
import { textChannelExists } from './channels.js';
import * as attachments from './attachments.js';
import type { AppSocket, HandlerTable, Participant } from '../types.js';

// Deleting a channel (modules/channels.ts) CASCADEs here.
//
// `ChatMessage.id` (the `id` field) holds the account's USERID, not the
// connection id (`p.id`) — messages persist across reconnects, so "is this
// my message?" and "did I react?" must survive tab/session changes too.
// The client compares against `state.me.userId`, not `state.me.id`.

const REPLY_PREVIEW_LEN = 120;

interface ReplyRef {
  msgId: number;
  name: string;
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
  replyTo?: unknown;
  reactions?: Record<string, string[]>;
  attachment?: { id: string; name: string; mime: string; size: number };
  // Echoed back only on the live broadcast reply to the message that
  // carried it — never persisted, never present on history/edit payloads.
  // Lets the SENDER's own client reconcile its optimistic bubble (see
  // RoomProvider.tsx) without depending on `id === myUserId`, which would
  // also match the same account's other tabs/devices.
  clientId?: string;
}

function sanitizeChatText(text: unknown): string {
  return String(text == null ? '' : text).trim().slice(0, config.MAX_CHAT_LEN);
}

/** A client-generated correlation id for one send attempt — arbitrary
 * opaque string, never stored or trusted beyond this one round trip. */
export function sanitizeClientId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= 100 ? trimmed : undefined;
}

export function canDeleteChatMessage(actor: Pick<Participant, 'userId' | 'role'>, authorId: string | null): boolean {
  return actor.role === 'admin' || authorId === actor.userId;
}

export function toggleMessageReaction(
  current: Record<string, string[]> | null | undefined,
  emoji: string,
  userId: string,
): Record<string, string[]> {
  const reactions: Record<string, string[]> = { ...(current || {}) };
  const list = reactions[emoji] ? [...reactions[emoji]] : [];
  const index = list.indexOf(userId);
  if (index === -1) list.push(userId); else list.splice(index, 1);
  if (list.length === 0) delete reactions[emoji]; else reactions[emoji] = list;
  return reactions;
}

/** `attachment` (optional) is the raw attachments-table row — the
 * attachment itself doesn't live in the messages table, see
 * modules/attachments.ts. */
function rowToMessage(row: Message, attachment?: Attachment): ChatMessagePayload {
  const out: ChatMessagePayload = {
    msgId: row.id,
    channelId: row.channelId,
    id: row.authorId,
    name: row.authorName,
    avatar: row.authorAvatar,
    text: row.text,
    ts: row.createdAt.getTime(),
  };
  if (row.editedAt) out.editedAt = row.editedAt.getTime();
  if (row.replyTo) out.replyTo = row.replyTo;
  const reactions = row.reactions as Record<string, string[]> | null;
  if (reactions && Object.keys(reactions).length) out.reactions = reactions;
  if (attachment) out.attachment = { id: attachment.id, name: attachment.fileName, mime: attachment.mimeType, size: attachment.size };
  return out;
}

/** Builds the frozen reference to the original message from the client's
 * msgId — silently returns undefined if it's gone (deleted) or from
 * another channel, so the reply just carries no reference instead of
 * failing outright. */
async function buildReplyRef(channelId: string, replyToId: unknown): Promise<ReplyRef | undefined> {
  const id = Number(replyToId);
  if (!Number.isFinite(id)) return undefined;
  const [original] = await db.select().from(messages).where(and(eq(messages.id, id), eq(messages.channelId, channelId))).limit(1);
  if (!original) return undefined;
  return { msgId: original.id, name: original.authorName, text: original.text.slice(0, REPLY_PREVIEW_LEN) };
}

/** Client opening a channel (switched tabs, or the first channel on join) —
 * sends the last CHAT_HISTORY_LIMIT messages to just THIS socket (no
 * broadcast). No pagination yet. */
async function handleChannelOpen(socket: AppSocket, msg: { channelId?: string }): Promise<void> {
  const p = participants.get(socket.participantId ?? '');
  if (!p || p.socket !== socket) return;
  const channelId = String(msg.channelId || '');
  if (!channelId || !(await textChannelExists(channelId))) return;
  const rows = await db.select().from(messages).where(eq(messages.channelId, channelId)).orderBy(desc(messages.id)).limit(config.CHAT_HISTORY_LIMIT);
  rows.reverse();
  // one query for all history messages' attachments, not one per message
  // (N+1) — most have no attachment anyway.
  const attachmentByMessageId = await attachments.getByMessageIds(rows.map((r) => r.id));
  send(socket, { t: 'channel-history', channelId, messages: rows.map((r) => rowToMessage(r, attachmentByMessageId.get(r.id))) });
}

async function handleChat(socket: AppSocket, msg: { channelId?: string; text?: string; replyTo?: unknown; clientId?: unknown }): Promise<void> {
  const p = participants.get(socket.participantId ?? '');
  if (!p || p.socket !== socket) return;
  const channelId = String(msg.channelId || '');
  const text = sanitizeChatText(msg.text);
  if (!channelId || !text || !(await textChannelExists(channelId))) return;
  const replyTo = await buildReplyRef(channelId, msg.replyTo);
  const [row] = await db.insert(messages).values({
    channelId, authorId: p.userId, authorName: p.name, authorAvatar: p.avatar, text,
    replyTo: replyTo || null,
  }).returning();
  const payload = rowToMessage(row!);
  const clientId = sanitizeClientId(msg.clientId);
  if (clientId) payload.clientId = clientId;
  broadcast({ t: 'chat', message: payload });
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
  broadcast({ t: 'chat-edited', message: rowToMessage(updated!, attachment) });
}

/** Toggles (not just adds) — reacting again with the same emoji removes
 * your own reaction, Discord-style. */
async function handleChatReact(socket: AppSocket, msg: { msgId?: unknown; emoji?: string }): Promise<void> {
  const p = participants.get(socket.participantId ?? '');
  if (!p || p.socket !== socket) return;
  const msgId = Number(msg.msgId);
  const emoji = String(msg.emoji || '');
  if (!Number.isFinite(msgId) || !ALLOWED_REACTIONS.has(emoji)) return;
  // Row lock makes the read/toggle/write atomic across simultaneous sockets
  // and even across future app replicas, without a reaction-table migration.
  const result = await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(messages).where(eq(messages.id, msgId)).limit(1).for('update');
    if (!existing) return null;
    const reactions = toggleMessageReaction(existing.reactions as Record<string, string[]> | null, emoji, p.userId);
    await tx.update(messages).set({ reactions }).where(eq(messages.id, msgId));
    return { channelId: existing.channelId, userIds: reactions[emoji] || [] };
  });
  if (!result) return;
  broadcast({ t: 'chat-reaction-updated', channelId: result.channelId, msgId, emoji, userIds: result.userIds });
}

// Author may delete their own message; admin may delete any. "Clear all" no
// longer exists: deleting the whole channel covers that now.
async function handleChatDelete(socket: AppSocket, msg: { msgId?: unknown }): Promise<void> {
  const p = participants.get(socket.participantId ?? '');
  if (!p || p.socket !== socket) return;
  const msgId = Number(msg.msgId);
  if (!Number.isFinite(msgId)) return;
  const [existing] = await db.select({ channelId: messages.channelId, authorId: messages.authorId }).from(messages).where(eq(messages.id, msgId)).limit(1);
  if (!existing || !canDeleteChatMessage(p, existing.authorId)) return;
  // delete the file on disk before the row — after the delete below, the
  // attachments row disappears via CASCADE, but nothing would know which
  // file to delete anymore (see modules/attachments.ts).
  await attachments.deleteForMessage(msgId);
  await db.delete(messages).where(eq(messages.id, msgId));
  broadcast({ t: 'chat-deleted', channelId: existing.channelId, msgId });
}

export const handlers: HandlerTable = {
  'channel-open': handleChannelOpen,
  chat: handleChat,
  'chat-delete': handleChatDelete,
  'chat-edit': handleChatEdit,
  'chat-react': handleChatReact,
};

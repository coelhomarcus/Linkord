import { eq, and, desc } from 'drizzle-orm';
import { config } from '../config/env.js';
import { db } from '../db/client.js';
import { messages, type Message, type Attachment } from '../db/schema.js';
import { participants, broadcast, send } from '../realtime/participants.js';
import { ALLOWED_REACTIONS } from '../realtime/reactions.js';
import { channelExists } from './channels.js';
import * as attachments from './attachments.js';
import type { AppSocket, HandlerTable } from '../types.js';

// ---------------------------------------------------------------------------
// Chat de texto, agora POR CANAL e persistido no Postgres (antes vivia so em
// memoria, um unico chat pra sala inteira, perdido a cada restart). Apagar
// um canal (modules/channels.ts) e CASCADE aqui — e assim que "excluir um
// chat apaga tudo pra sempre" funciona, sem precisar apagar linha por linha.
//
// `ChatMessage.id` (campo `id` no protocolo) guarda o USERID da conta, nao
// mais o id de conexao (`p.id`) — mensagens agora sobrevivem a reconexoes e
// reloads, entao "e minha mensagem?" (pra poder editar) e "eu reagi?" tem
// que sobreviver a troca de aba/sessao tambem. O cliente compara contra
// `state.me.userId`, nao `state.me.id`.
// ---------------------------------------------------------------------------

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
}

function sanitizeChatText(text: unknown): string {
  return String(text == null ? '' : text).trim().slice(0, config.MAX_CHAT_LEN);
}

/** `attachment` (opcional) e a linha crua da tabela attachments — o proprio
 * anexo NAO mora na tabela messages, ver modules/attachments.ts. */
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

/** Monta a referencia congelada da mensagem original a partir do msgId que o
 * cliente mandou — se ja nao existir mais (apagada) ou for de outro canal,
 * retorna undefined em silencio (a resposta so nao carrega referencia
 * nenhuma, em vez de falhar a mensagem inteira). */
async function buildReplyRef(channelId: string, replyToId: unknown): Promise<ReplyRef | undefined> {
  const id = Number(replyToId);
  if (!Number.isFinite(id)) return undefined;
  const [original] = await db.select().from(messages).where(and(eq(messages.id, id), eq(messages.channelId, channelId))).limit(1);
  if (!original) return undefined;
  return { msgId: original.id, name: original.authorName, text: original.text.slice(0, REPLY_PREVIEW_LEN) };
}

/** Cliente abrindo um canal (trocou de aba, ou primeiro canal ao entrar) —
 * manda so pra ESSE socket (nao broadcast), as ultimas CHAT_HISTORY_LIMIT
 * mensagens. Sem paginacao (fora de escopo por enquanto). */
async function handleChannelOpen(socket: AppSocket, msg: { channelId?: string }): Promise<void> {
  const p = participants.get(socket.participantId ?? '');
  if (!p || p.socket !== socket) return;
  const channelId = String(msg.channelId || '');
  if (!channelId || !(await channelExists(channelId))) return;
  const rows = await db.select().from(messages).where(eq(messages.channelId, channelId)).orderBy(desc(messages.id)).limit(config.CHAT_HISTORY_LIMIT);
  rows.reverse();
  // uma query so pros anexos de TODAS as mensagens do historico, em vez de
  // uma por mensagem (N+1) — a maioria nao tem anexo nenhum de qualquer jeito.
  const attachmentByMessageId = await attachments.getByMessageIds(rows.map((r) => r.id));
  send(socket, { t: 'channel-history', channelId, messages: rows.map((r) => rowToMessage(r, attachmentByMessageId.get(r.id))) });
}

async function handleChat(socket: AppSocket, msg: { channelId?: string; text?: string; replyTo?: unknown }): Promise<void> {
  const p = participants.get(socket.participantId ?? '');
  if (!p || p.socket !== socket) return;
  const channelId = String(msg.channelId || '');
  const text = sanitizeChatText(msg.text);
  if (!channelId || !text || !(await channelExists(channelId))) return;
  const replyTo = await buildReplyRef(channelId, msg.replyTo);
  const [row] = await db.insert(messages).values({
    channelId, authorId: p.userId, authorName: p.name, authorAvatar: p.avatar, text,
    replyTo: replyTo || null,
  }).returning();
  broadcast({ t: 'chat', message: rowToMessage(row!) });
}

/** So o autor original edita — nem admin, igual o Discord (admin so pode
 * apagar, ver handleChatDelete). Comparado por userId, nao id de conexao —
 * continua sendo "seu" depois de reconectar/recarregar. */
async function handleChatEdit(socket: AppSocket, msg: { msgId?: unknown; text?: string }): Promise<void> {
  const p = participants.get(socket.participantId ?? '');
  if (!p || p.socket !== socket) return;
  const msgId = Number(msg.msgId);
  const text = sanitizeChatText(msg.text);
  if (!Number.isFinite(msgId) || !text) return;
  const [existing] = await db.select().from(messages).where(eq(messages.id, msgId)).limit(1);
  if (!existing || existing.authorId !== p.userId) return;
  const [updated] = await db.update(messages).set({ text, editedAt: new Date() }).where(eq(messages.id, msgId)).returning();
  // sem isso, editar a legenda de uma mensagem COM anexo fazia o anexo
  // sumir da tela pra todo mundo (o cliente substitui a mensagem inteira
  // pelo que chega em 'chat-edited', ver RoomProvider.tsx).
  const attachment = (await attachments.getByMessageIds([msgId])).get(msgId);
  broadcast({ t: 'chat-edited', message: rowToMessage(updated!, attachment) });
}

/** Alterna (nao so adiciona) — reagir de novo com o mesmo emoji tira a
 * propria reacao, igual o Discord. */
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

// ---- moderacao (so admin) — apagar UMA mensagem. "Limpar tudo" nao existe
// mais: apagar o canal inteiro (modules/channels.ts) cobre esse caso agora. --
async function handleChatDelete(socket: AppSocket, msg: { msgId?: unknown }): Promise<void> {
  const p = participants.get(socket.participantId ?? '');
  if (!p || p.socket !== socket || p.role !== 'admin') return;
  const msgId = Number(msg.msgId);
  if (!Number.isFinite(msgId)) return;
  const [existing] = await db.select({ channelId: messages.channelId }).from(messages).where(eq(messages.id, msgId)).limit(1);
  if (!existing) return;
  // apaga o ARQUIVO de disco antes da linha — depois do delete abaixo, a
  // linha de attachments some sozinha via CASCADE, mas ninguem mais saberia
  // qual arquivo apagar (ver modules/attachments.ts).
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

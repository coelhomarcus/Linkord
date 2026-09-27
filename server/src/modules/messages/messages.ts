import { sendUsageToUser } from '../attachments/attachmentQuota.js';
import { isActiveAdmin } from '../admin/adminAuth.js';
import { recordAudit } from '../admin/auditLog.js';
import { eq, and, desc, asc, lt, gt, gte, sql } from 'drizzle-orm';
import { config } from '../../config/env.js';
import { db } from '../../db/client.js';
import { messages, conversationMembers, users, type Message, type Attachment } from '../../db/schema.js';
import { participants, send, sendSocketError } from '../presence/participants.js';
import { isSingleEmoji } from './emoji.js';
import {
  broadcastToConversationMembers,
  conversationDisplayName,
  conversationExistsForUser,
  getDirectPeerId,
  touchConversation,
  recordConversationActivity,
} from '../conversations/conversationsRepository.js';
import { canSendDirectMessage } from '../friendships/friendshipsRepository.js';
import { resolveDisplayName } from '../users/users.js';
import * as attachments from '../attachments/attachments.js';
import { deleteForMessage } from '../attachments/attachmentCleanup.js';
import * as reactions from './reactions.js';
import { buildReplyRef, normalizeReplyRef, type ReplyRef } from './replyRef.js';
import { insertMessageOnce, isValidClientMessageId, sendPayloadHash } from './sendOperations.js';
import { publishStaged, StagedUnavailableError } from '../attachments/stagedAttachments.js';
import { ERROR_CODES, type ErrorCode } from '../../http/errors.js';
import { loadInvitationCards, type InvitationCard } from '../conversations/invitationCards.js';
import { revokeInvitationForDeletedCard } from '../conversations/invitationsRepository.js';
import type { AppSocket, HandlerTable, Participant } from '../../types.js';
import { logger } from '../../lib/logger.js';

const log = logger.child({ component: 'audit' });

// Etapa 6 (docs/plano-rede-social.md §4.3): "não enviar, reagir, anexar,
// digitar" while contact is restricted (not friends, or blocked) — this is
// the shared gate every one of those write paths calls. `getDirectPeerId`
// returns null for a group conversation, so the check no-ops there on its
// own; reading history (open/load-more/around/search) is NEVER gated —
// only these write actions are.
async function assertCanWriteToConversation(socket: AppSocket, conversationId: string, userId: string): Promise<boolean> {
  const peerId = await getDirectPeerId(conversationId, userId);
  if (peerId && !(await canSendDirectMessage(userId, peerId))) {
    sendSocketError(socket, ERROR_CODES.relationshipRequired, 'Vocês precisam ser amigos pra conversar por aqui.');
    return false;
  }
  return true;
}

// Deleting a conversation CASCADEs here.
//
// `ChatMessage.id` (the `id` field) holds the account's USERID, not the
// connection id (`p.id`) — messages persist across reconnects, so "is this
// my message?" and "did I react?" must survive tab/session changes too.
// The client compares against `state.me.userId`, not `state.me.id`.

const DELETED_AUTHOR_NAME = 'Usuário apagado';
// split of CHAT_HISTORY_LIMIT for handleLoadMessagesAround — half before
// the target, half from (and including) it.
const AROUND_BEFORE_LIMIT = Math.floor(config.CHAT_HISTORY_LIMIT / 2);
const AROUND_AFTER_LIMIT = config.CHAT_HISTORY_LIMIT - AROUND_BEFORE_LIMIT;

function conversationIdFrom(msg: { conversationId?: string }): string {
  return String(msg.conversationId || '');
}

interface ChatMessagePayload {
  msgId: number;
  conversationId: string;
  id: string | null;
  name: string;
  avatar: string;
  text: string;
  ts: number;
  editedAt?: number;
  replyTo?: ReplyRef;
  reactions?: Record<string, string[]>;
  attachments?: { id: string; name: string; mime: string; size: number; thumbId?: string; width?: number; height?: number }[];
  // the author's send key, echoed back so their client can reconcile its
  // pending copy with the stored message
  clientMessageId?: string;
  // only set for structured messages — absent means a plain text message
  kind?: 'group_invite';
  // the invitation's CURRENT state, resolved at read time so a card is right
  // after a refresh; null is the tombstone (its group was deleted)
  invitation?: InvitationCard | null;
}

interface MessageWithAuthor {
  id: number;
  conversationId: string;
  authorId: string | null;
  authorUsername: string | null;
  authorDisplayName: string | null;
  authorAvatar: string | null;
  text: string;
  createdAt: Date;
  editedAt: Date | null;
  replyTo: unknown;
  kind: string;
  groupInvitationId: string | null;
}

function sanitizeChatText(text: unknown): string {
  return String(text == null ? '' : text).trim().slice(0, config.MAX_CHAT_LEN);
}

const messageWithAuthorSelect = {
  id: messages.id,
  conversationId: messages.conversationId,
  authorId: messages.authorId,
  authorUsername: users.username,
  authorDisplayName: users.displayName,
  authorAvatar: users.avatar,
  text: messages.text,
  createdAt: messages.createdAt,
  editedAt: messages.editedAt,
  replyTo: messages.replyTo,
  kind: messages.kind,
  groupInvitationId: messages.groupInvitationId,
};

function rowWithParticipant(row: Message, participant: Participant): MessageWithAuthor {
  return {
    id: row.id,
    conversationId: row.conversationId,
    authorId: row.authorId,
    authorUsername: participant.name,
    authorDisplayName: participant.displayName,
    authorAvatar: participant.avatar,
    text: row.text,
    createdAt: row.createdAt,
    editedAt: row.editedAt,
    replyTo: row.replyTo,
    kind: row.kind,
    groupInvitationId: row.groupInvitationId,
  };
}

function authorNameFor(row: MessageWithAuthor): string {
  return row.authorUsername
    ? resolveDisplayName(row.authorDisplayName ?? '', row.authorUsername)
    : DELETED_AUTHOR_NAME;
}

/** `attachments` (optional, up to MAX_ATTACHMENTS_PER_MESSAGE) are the raw
 * attachments-table rows, and `reactionsByEmoji` the grouped
 * message_reactions rows for this message — neither lives in the messages
 * table itself, see modules/attachments.ts and modules/reactions.ts. */
function rowToMessage(row: MessageWithAuthor, attachments?: Attachment[], reactionsByEmoji?: Record<string, string[]>, invitation?: InvitationCard): ChatMessagePayload {
  const out: ChatMessagePayload = {
    msgId: row.id,
    conversationId: row.conversationId,
    id: row.authorId,
    name: authorNameFor(row),
    avatar: row.authorAvatar ?? '',
    text: row.text,
    ts: row.createdAt.getTime(),
  };
  if (row.editedAt) out.editedAt = row.editedAt.getTime();
  if (row.kind === 'group_invite') {
    out.kind = 'group_invite';
    out.invitation = invitation ?? null;
  }
  const replyTo = normalizeReplyRef(row.replyTo);
  if (replyTo) out.replyTo = replyTo;
  if (reactionsByEmoji && Object.keys(reactionsByEmoji).length) out.reactions = reactionsByEmoji;
  if (attachments?.length) {
    out.attachments = attachments.map((a) => ({
      id: a.id, name: a.fileName, mime: a.mimeType, size: a.size, ...(a.thumbId ? { thumbId: a.thumbId } : {}),
      ...(a.width && a.height ? { width: a.width, height: a.height } : {}),
    }));
  }
  return out;
}

/** Serializes a page of rows with everything that lives outside the messages
 * table, each fetched ONCE for the whole page (attachments, reactions and
 * invitation cards) — never a query per message. */
async function serializeRows(rows: MessageWithAuthor[]): Promise<ChatMessagePayload[]> {
  const messageIds = rows.map((r) => r.id);
  const cardIds = rows.flatMap((r) => (r.kind === 'group_invite' && r.groupInvitationId ? [r.groupInvitationId] : []));
  const [attachmentByMessageId, reactionsByMessageId, cards] = await Promise.all([
    attachments.getByMessageIds(messageIds),
    reactions.getByMessageIds(messageIds),
    loadInvitationCards(cardIds),
  ]);
  return rows.map((r) => rowToMessage(
    r, attachmentByMessageId.get(r.id), reactionsByMessageId.get(r.id),
    r.groupInvitationId ? cards.get(r.groupInvitationId) : undefined,
  ));
}

/** Client opening a conversation — sends the last CHAT_HISTORY_LIMIT messages
 * to just THIS socket (no broadcast). Older pages are fetched on demand via
 * 'load-more-messages' (see handleLoadMoreMessages below). */
async function handleConversationOpen(socket: AppSocket, msg: { conversationId?: string }): Promise<void> {
  const p = participants.get(socket.participantId ?? '');
  if (!p || p.socket !== socket) return;
  const conversationId = conversationIdFrom(msg);
  if (!conversationId || !(await conversationExistsForUser(conversationId, p.userId))) return;
  const rows = await db
    .select(messageWithAuthorSelect)
    .from(messages)
    .leftJoin(users, eq(users.id, messages.authorId))
    .where(eq(messages.conversationId, conversationId))
    .orderBy(desc(messages.id))
    .limit(config.CHAT_HISTORY_LIMIT);
  rows.reverse();
  // one query for all history messages' attachments/reactions, not one per
  // message (N+1) — most have neither anyway.
  const payloads = await serializeRows(rows);
  send(socket, {
    t: 'conversation-history',
    conversationId,
    messages: payloads,
    hasMore: rows.length === config.CHAT_HISTORY_LIMIT,
  });

  // Opening a conversation means "I've seen everything up to its newest
  // message" — record that and let the user's OTHER tabs/devices know, so
  // an unread badge doesn't linger somewhere just because it was cleared
  // here. Not marked on load-more/jump-to-message: scrolling up or landing
  // on an old search result isn't "read up to the latest".
  const newest = rows[rows.length - 1];
  if (newest) {
    await db.update(conversationMembers)
      .set({ lastReadMessageId: newest.id })
      .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, p.userId)));
    for (const participant of participants.values()) {
      if (participant.userId === p.userId) send(participant.socket, { t: 'conversation-read', conversationId, lastReadMessageId: newest.id });
    }
  }
}

/** Client scrolled to the top of an already-open conversation — sends up to
 * CHAT_HISTORY_LIMIT messages older than `beforeMsgId` (the oldest one the
 * client currently has), for it to PREPEND to existing history. */
/** Echoed on history pages so a client can drop a page that answers a
 * request it has since replaced (a jump, a switch). */
function pageRequestId(msg: { requestId?: unknown }): { requestId?: string } {
  return typeof msg.requestId === 'string' && msg.requestId.length <= 64 ? { requestId: msg.requestId } : {};
}

async function handleLoadMoreMessages(socket: AppSocket, msg: { conversationId?: string; beforeMsgId?: unknown; requestId?: unknown }): Promise<void> {
  const p = participants.get(socket.participantId ?? '');
  if (!p || p.socket !== socket) return;
  const conversationId = conversationIdFrom(msg);
  const beforeMsgId = Number(msg.beforeMsgId);
  if (!conversationId || !Number.isFinite(beforeMsgId) || !(await conversationExistsForUser(conversationId, p.userId))) return;
  const rows = await db
    .select(messageWithAuthorSelect)
    .from(messages)
    .leftJoin(users, eq(users.id, messages.authorId))
    .where(and(eq(messages.conversationId, conversationId), lt(messages.id, beforeMsgId)))
    .orderBy(desc(messages.id))
    .limit(config.CHAT_HISTORY_LIMIT);
  rows.reverse();
  const payloads = await serializeRows(rows);
  send(socket, {
    t: 'conversation-history-more',
    conversationId,
    messages: payloads,
    hasMore: rows.length === config.CHAT_HISTORY_LIMIT,
    ...pageRequestId(msg),
  });
}

/** Newer than X: lets a window opened on old history (a search result, a
 * reply jump) walk forward to the present instead of jumping there. */
async function handleLoadMessagesAfter(socket: AppSocket, msg: { conversationId?: string; afterMsgId?: unknown; requestId?: unknown }): Promise<void> {
  const p = participants.get(socket.participantId ?? '');
  if (!p || p.socket !== socket) return;
  const conversationId = conversationIdFrom(msg);
  const afterMsgId = Number(msg.afterMsgId);
  if (!conversationId || !Number.isFinite(afterMsgId) || !(await conversationExistsForUser(conversationId, p.userId))) return;
  const rows = await db
    .select(messageWithAuthorSelect)
    .from(messages)
    .leftJoin(users, eq(users.id, messages.authorId))
    .where(and(eq(messages.conversationId, conversationId), gt(messages.id, afterMsgId)))
    .orderBy(asc(messages.id))
    .limit(config.CHAT_HISTORY_LIMIT);
  send(socket, {
    t: 'conversation-history-newer',
    conversationId,
    messages: await serializeRows(rows),
    hasMoreAfter: rows.length === config.CHAT_HISTORY_LIMIT,
    ...pageRequestId(msg),
  });
}

/** Search-result click target: a window of history CENTERED on `msgId`,
 * unlike handleConversationOpen ("latest") or handleLoadMoreMessages ("older
 * than X") — the client fully replaces its loaded range for this conversation
 * with the result (see RoomProvider.tsx#jumpToMessage), same "recenter"
 * shape as opening a conversation, just anchored differently instead of
 * preserving whatever was loaded before. */
async function handleLoadMessagesAround(socket: AppSocket, msg: { conversationId?: string; msgId?: unknown; requestId?: unknown }): Promise<void> {
  const p = participants.get(socket.participantId ?? '');
  if (!p || p.socket !== socket) return;
  const conversationId = conversationIdFrom(msg);
  const msgId = Number(msg.msgId);
  if (!conversationId || !Number.isFinite(msgId) || !(await conversationExistsForUser(conversationId, p.userId))) return;

  // a search result can point at a message deleted since the search ran —
  // without this check the two queries below would just silently return an
  // empty/off window instead of telling the client why.
  const [target] = await db.select({ id: messages.id }).from(messages)
    .where(and(eq(messages.id, msgId), eq(messages.conversationId, conversationId))).limit(1);
  if (!target) {
      sendSocketError(socket, 'message-not-found', 'Essa mensagem não existe mais.');
    return;
  }

  const [beforeRows, afterRows] = await Promise.all([
    db.select(messageWithAuthorSelect).from(messages).leftJoin(users, eq(users.id, messages.authorId))
      .where(and(eq(messages.conversationId, conversationId), lt(messages.id, msgId)))
      .orderBy(desc(messages.id)).limit(AROUND_BEFORE_LIMIT),
    db.select(messageWithAuthorSelect).from(messages).leftJoin(users, eq(users.id, messages.authorId))
      .where(and(eq(messages.conversationId, conversationId), gte(messages.id, msgId)))
      .orderBy(asc(messages.id)).limit(AROUND_AFTER_LIMIT),
  ]);
  beforeRows.reverse();
  const rows = [...beforeRows, ...afterRows];
  const payloads = await serializeRows(rows);
  send(socket, {
    t: 'conversation-history-around',
    conversationId,
    msgId,
    messages: payloads,
    hasMoreBefore: beforeRows.length === AROUND_BEFORE_LIMIT,
    hasMoreAfter: afterRows.length === AROUND_AFTER_LIMIT,
    ...pageRequestId(msg),
  });
}

/** Full-text search — `conversationId` omitted searches every accessible
 * conversation, present scopes to just that one. See db/schema.ts#messages.searchVector for the
 * indexed side; websearch_to_tsquery never throws on malformed input
 * (quoted phrases / -exclude / or all work, garbage input just matches
 * nothing), so it's safe to feed raw user text directly into it. */
async function handleMessageSearch(socket: AppSocket, msg: { query?: string; conversationId?: string }): Promise<void> {
  const p = participants.get(socket.participantId ?? '');
  if (!p || p.socket !== socket) return;
  const query = String(msg.query || '').trim().slice(0, config.MAX_SEARCH_QUERY_LEN);
  const conversationId = msg.conversationId ? conversationIdFrom(msg) : undefined;
  if (!query) {
    send(socket, { t: 'message-search-results', query, conversationId, results: [] });
    return;
  }
  if (conversationId && !(await conversationExistsForUser(conversationId, p.userId))) return;

  const tsQuery = sql`websearch_to_tsquery('portuguese', ${query})`;
  const rank = sql`ts_rank(${messages.searchVector}, ${tsQuery})`;
  // Private-Use-Area delimiters (never typed in real chat text) instead of
  // HTML — the client splits on them into plain-text/highlight React nodes
  // itself (mirrors ChatMessageText.tsx's own "never build HTML strings"
  // convention), no dangerouslySetInnerHTML anywhere.
  const snippet = sql<string>`ts_headline('portuguese', ${messages.text}, ${tsQuery}, 'StartSel=, StopSel=, MaxFragments=1, MaxWords=20, MinWords=6')`;

  const rows = await db
    .select({ ...messageWithAuthorSelect, snippet })
    .from(messages)
    .innerJoin(conversationMembers, and(
      eq(conversationMembers.conversationId, messages.conversationId),
      eq(conversationMembers.userId, p.userId),
    ))
    .leftJoin(users, eq(users.id, messages.authorId))
    .where(and(
      sql`${messages.searchVector} @@ ${tsQuery}`,
      conversationId ? eq(messages.conversationId, conversationId) : undefined,
    ))
    .orderBy(desc(rank), desc(messages.id))
    .limit(config.SEARCH_RESULT_LIMIT);

  const results = await Promise.all(rows.map(async (r) => {
    const conversationName = await conversationDisplayName(r.conversationId, p.userId);
    return {
      msgId: r.id,
      conversationId: r.conversationId,
      conversationName,
      id: r.authorId,
      name: authorNameFor(r),
      avatar: r.authorAvatar ?? '',
      ts: r.createdAt.getTime(),
      snippet: r.snippet,
    };
  }));

  send(socket, {
    t: 'message-search-results',
    query,
    conversationId,
    results,
  });
}

interface ChatSendRequest {
  conversationId?: string;
  text?: string;
  replyTo?: unknown;
  requestId?: unknown;
  clientMessageId?: unknown;
  attachmentIds?: unknown;
}

const ATTACHMENT_ID_RE = /^[0-9a-f]{32}$/;

/** Staged file ids for a batch send, in the sender's order; null when the
 * field is malformed (not merely absent). */
function parseAttachmentIds(raw: unknown): string[] | null {
  if (raw == null) return [];
  if (!Array.isArray(raw) || raw.length > config.MAX_ATTACHMENTS_PER_MESSAGE) return null;
  if (!raw.every((id) => typeof id === 'string' && ATTACHMENT_ID_RE.test(id))) return null;
  return new Set(raw).size === raw.length ? raw as string[] : null;
}

/** Every outcome of a correlated send gets an answer — a client waiting on
 * one can't tell a silent refusal from a lost reply, and would retry. */
function sendChatResult(socket: AppSocket, msg: ChatSendRequest, result: { message: ChatMessagePayload } | { error: { code: ErrorCode; message: string } }): void {
  send(socket, { t: 'chat-send-result', requestId: String(msg.requestId ?? ''), clientMessageId: String(msg.clientMessageId ?? ''), ...result });
}

/** For refusals decided before the handler runs (the dispatcher's rate
 * limit), so a correlated send still gets its answer. */
export function rejectCorrelated(event: string, socket: AppSocket, msg: unknown, code: ErrorCode, message: string): boolean {
  const req = (msg || {}) as ChatSendRequest;
  if (event === 'chat') {
    if (!isValidClientMessageId(req.clientMessageId)) return false;
    sendChatResult(socket, req, { error: { code, message } });
    return true;
  }
  if ((event === 'chat-edit' || event === 'chat-delete' || event === 'chat-react') && isRequestId(req.requestId)) {
    answerAction(socket, req, { code, message });
    return true;
  }
  return false;
}

async function handleChat(socket: AppSocket, msg: ChatSendRequest): Promise<void> {
  if (isValidClientMessageId(msg.clientMessageId)) return handleCorrelatedChat(socket, msg, msg.clientMessageId);
  const p = participants.get(socket.participantId ?? '');
  if (!p || p.socket !== socket) return;
  const conversationId = conversationIdFrom(msg);
  const text = sanitizeChatText(msg.text);
  if (!conversationId || !text || !(await conversationExistsForUser(conversationId, p.userId))) return;
  if (!(await assertCanWriteToConversation(socket, conversationId, p.userId))) return;
  const replyTo = await buildReplyRef(conversationId, msg.replyTo);
  const [row] = await db.insert(messages).values({
    conversationId, authorId: p.userId, text,
    replyTo: replyTo || null,
  }).returning();
  await touchConversation(conversationId, row!.createdAt);
  await broadcastToConversationMembers(conversationId, { t: 'chat', message: rowToMessage(rowWithParticipant(row!, p)) });
}

/** The send path of clients that announce a `clientMessageId`: idempotent
 * per intent, and always answered with `chat-send-result`. */
async function handleCorrelatedChat(socket: AppSocket, msg: ChatSendRequest, clientMessageId: string): Promise<void> {
  const p = participants.get(socket.participantId ?? '');
  if (!p || p.socket !== socket) return;
  const fail = (code: ErrorCode, message: string) => sendChatResult(socket, msg, { error: { code, message } });
  try {
    const conversationId = conversationIdFrom(msg);
    const rawText = String(msg.text ?? '').trim();
    const attachmentIds = parseAttachmentIds(msg.attachmentIds);
    if (!attachmentIds) return fail('invalid_message', `Anexos inválidos (máximo ${config.MAX_ATTACHMENTS_PER_MESSAGE}).`);
    // a batch may go without a caption; a plain message may not be empty
    if (!conversationId || (!rawText && !attachmentIds.length)) return fail('invalid_message', 'Mensagem vazia.');
    // unlike the legacy path, never cut it: the client shows a counter
    if (rawText.length > config.MAX_CHAT_LEN) return fail('message_too_long', `A mensagem passa de ${config.MAX_CHAT_LEN} caracteres.`);
    if (!(await conversationExistsForUser(conversationId, p.userId))) return fail('conversation_not_found', 'Conversa não encontrada.');
    const peerId = await getDirectPeerId(conversationId, p.userId);
    if (peerId && !(await canSendDirectMessage(p.userId, peerId))) {
      return fail(ERROR_CODES.relationshipRequired, 'Vocês precisam ser amigos pra conversar por aqui.');
    }
    const replyTo = await buildReplyRef(conversationId, msg.replyTo);
    let outcome;
    try {
      outcome = await insertMessageOnce({
        authorId: p.userId,
        clientMessageId,
        payloadHash: sendPayloadHash({ conversationId, text: rawText, replyTo: replyTo?.msgId ?? null, attachmentIds }),
        values: { conversationId, authorId: p.userId, text: rawText, replyTo: replyTo || null },
        // access was re-checked above, at publish time, not only at upload init
        attach: attachmentIds.length
          ? (tx, row) => publishStaged(tx, { ids: attachmentIds, ownerId: p.userId, conversationId, messageId: row.id })
          : undefined,
      });
    } catch (err) {
      if (err instanceof StagedUnavailableError) {
        return fail('attachments_unavailable', 'Algum anexo expirou ou não está mais disponível. Escolha os arquivos de novo.');
      }
      throw err;
    }
    if (outcome.status === 'conflict') return fail(ERROR_CODES.conflict, 'Essa chave de envio já foi usada para outra mensagem.');
    if (outcome.status === 'deleted') return fail('message_deleted', 'Essa mensagem foi enviada e depois apagada.');
    if (outcome.status === 'duplicate') {
      // the original already went out to everyone; this only answers the
      // sender whose first reply got lost
      const [existing] = await serializeRows(await db.select(messageWithAuthorSelect).from(messages)
        .leftJoin(users, eq(users.id, messages.authorId)).where(eq(messages.id, outcome.messageId)).limit(1));
      if (!existing) return fail('message_deleted', 'Essa mensagem foi enviada e depois apagada.');
      return sendChatResult(socket, msg, { message: { ...existing, clientMessageId } });
    }
    const message = { ...rowToMessage(rowWithParticipant(outcome.row, p), outcome.attachments), clientMessageId };
    // answered before the broadcast: a failure fanning out must not make a
    // persisted send look failed and invite a retry
    sendChatResult(socket, msg, { message });
    await touchConversation(conversationId, outcome.row.createdAt);
    await broadcastToConversationMembers(conversationId, { t: 'chat', message });
  } catch (err) {
    log.error('correlated chat send failed', err, { userId: p.userId });
    fail('internal_error', 'Não foi possível enviar agora.');
  }
}

/** Only the original author edits — not even admin (Discord-like; admin
 * can only delete, see handleChatDelete). Compared by userId, not
 * connection id — stays "yours" after reconnecting/reloading. */
type ActionFailure = { code: ErrorCode; message: string };

const isRequestId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 64;

/** Edit and delete answer a client that sent a requestId (protocol 4) with
 * chat-action-result, so it can keep the editor open on failure instead of
 * assuming success. Without one they stay silent, as before. */
function answerAction(socket: AppSocket, msg: { requestId?: unknown }, failure: ActionFailure | null): void {
  if (!isRequestId(msg.requestId)) return;
  send(socket, { t: 'chat-action-result', requestId: msg.requestId, ...(failure ? { error: failure } : {}) });
}

async function editMessage(p: Participant, msg: { msgId?: unknown; text?: string; requestId?: unknown }): Promise<ActionFailure | null> {
  const msgId = Number(msg.msgId);
  const rawText = String(msg.text ?? '').trim();
  if (!Number.isFinite(msgId) || !rawText) return { code: 'invalid_message', message: 'Mensagem vazia.' };
  // a correlated client shows a counter, so it is told instead of cut
  if (isRequestId(msg.requestId) && rawText.length > config.MAX_CHAT_LEN) return { code: 'message_too_long', message: `A mensagem passa de ${config.MAX_CHAT_LEN} caracteres.` };
  const text = sanitizeChatText(rawText);
  const [existing] = await db.select().from(messages).where(eq(messages.id, msgId)).limit(1);
  if (!existing) return { code: 'not_found', message: 'Essa mensagem não existe mais.' };
  if (existing.authorId !== p.userId || existing.kind !== 'text') return { code: 'forbidden', message: 'Você só pode editar as suas mensagens.' };
  if (!(await conversationExistsForUser(existing.conversationId, p.userId))) return { code: 'conversation_not_found', message: 'Conversa não encontrada.' };
  // §4.3: editing an old message while contact is restricted would be a
  // backdoor around the send-gate above — closing that is the specific
  // reason edit (not delete) is restricted here.
  const peerId = await getDirectPeerId(existing.conversationId, p.userId);
  if (peerId && !(await canSendDirectMessage(p.userId, peerId))) return { code: ERROR_CODES.relationshipRequired, message: 'Vocês precisam ser amigos pra conversar por aqui.' };
  const [updated] = await db.update(messages).set({ text, editedAt: new Date() }).where(eq(messages.id, msgId)).returning();
  // without these, editing a caption on a message WITH an attachment or a
  // reaction made it disappear for everyone (the client replaces the whole
  // message with what arrives in 'chat-edited', see RoomProvider.tsx).
  const [attachment, reactionsByEmoji] = await Promise.all([
    attachments.getByMessageIds([msgId]).then((m) => m.get(msgId)),
    reactions.getByMessageIds([msgId]).then((m) => m.get(msgId)),
  ]);
  await recordConversationActivity(existing.conversationId);
  await broadcastToConversationMembers(existing.conversationId, { t: 'chat-edited', message: rowToMessage(rowWithParticipant(updated!, p), attachment, reactionsByEmoji) });
  return null;
}

async function handleChatEdit(socket: AppSocket, msg: { msgId?: unknown; text?: string; requestId?: unknown }): Promise<void> {
  const p = participants.get(socket.participantId ?? '');
  if (!p || p.socket !== socket) return;
  const failure = await editMessage(p, msg);
  if (!isRequestId(msg.requestId) && failure?.code === ERROR_CODES.relationshipRequired) sendSocketError(socket, failure.code, failure.message);
  answerAction(socket, msg, failure);
}

/** Toggles (not just adds) — reacting again with the same emoji removes
 * your own reaction, Discord-style. */
async function handleChatReact(socket: AppSocket, msg: { msgId?: unknown; emoji?: string; present?: unknown; requestId?: unknown }): Promise<void> {
  const p = participants.get(socket.participantId ?? '');
  if (!p || p.socket !== socket) return;
  // protocol 5: a desired state (present true/false), answered; older
  // clients send neither and get the toggle, silently, as before
  const desired = typeof msg.present === 'boolean' ? msg.present : null;
  const fail = (failure: ActionFailure) => {
    if (desired === null && failure.code === ERROR_CODES.relationshipRequired) sendSocketError(socket, failure.code, failure.message);
    answerAction(socket, msg, failure);
  };
  const msgId = Number(msg.msgId);
  const emoji = String(msg.emoji || '');
  if (!Number.isFinite(msgId) || !isSingleEmoji(emoji)) return fail({ code: 'invalid_message', message: 'Reação inválida.' });
  const [existing] = await db.select({ conversationId: messages.conversationId, kind: messages.kind }).from(messages).where(eq(messages.id, msgId)).limit(1);
  if (!existing) return fail({ code: 'not_found', message: 'Essa mensagem não existe mais.' });
  if (existing.kind !== 'text') return fail({ code: 'forbidden', message: 'Convites não recebem reações.' });
  if (!(await conversationExistsForUser(existing.conversationId, p.userId))) return fail({ code: 'conversation_not_found', message: 'Conversa não encontrada.' });
  const peerId = await getDirectPeerId(existing.conversationId, p.userId);
  if (peerId && !(await canSendDirectMessage(p.userId, peerId))) return fail({ code: ERROR_CODES.relationshipRequired, message: 'Vocês precisam ser amigos pra conversar por aqui.' });

  let userIds: string[];
  if (desired === null) {
    userIds = await reactions.toggle(msgId, p.userId, emoji);
  } else {
    const result = await reactions.setPresence(msgId, p.userId, emoji, desired);
    // a repeat that changed nothing has nothing new to tell anyone
    if (!result.changed) return answerAction(socket, msg, null);
    userIds = result.userIds;
  }
  await broadcastToConversationMembers(existing.conversationId, {
    t: 'chat-reaction-updated',
    conversationId: existing.conversationId,
    msgId,
    emoji,
    userIds,
  });
  // after the broadcast (same socket, so it arrives after): the client drops
  // its optimistic copy only once the real list is already there
  answerAction(socket, msg, null);
}

// the original author OR an admin can delete — same split as
// handleChatEdit, except admin gets delete too (never edit, see above).
// "Clear all" no longer exists: deleting the whole conversation covers that now.
async function deleteMessage(p: Participant, msg: { msgId?: unknown }): Promise<ActionFailure | null> {
  const msgId = Number(msg.msgId);
  if (!Number.isFinite(msgId)) return { code: 'not_found', message: 'Essa mensagem não existe mais.' };
  const [existing] = await db
    .select({ conversationId: messages.conversationId, authorId: messages.authorId, kind: messages.kind, groupInvitationId: messages.groupInvitationId })
    .from(messages)
    .where(eq(messages.id, msgId))
    .limit(1);
  // already gone is the outcome a delete wanted: not an error to show
  if (!existing) return null;
  if (!(await conversationExistsForUser(existing.conversationId, p.userId))) return { code: 'conversation_not_found', message: 'Conversa não encontrada.' };
  const isAuthor = existing.authorId === p.userId;
  // admin authority is re-read, not taken from the connection's frozen role (§7.5)
  if (!isAuthor && !(await isActiveAdmin(p.userId))) return { code: 'forbidden', message: 'Você só pode apagar as suas mensagens.' };
  // before the row goes: a card that vanished while its invitation stayed
  // acceptable is exactly the desync this prevents
  if (existing.kind === 'group_invite' && existing.groupInvitationId) {
    await revokeInvitationForDeletedCard(existing.groupInvitationId);
  }
  // delete the file on disk before the row — after the delete below, the
  // attachments row disappears via CASCADE, but nothing would know which
  // file to delete anymore (see attachments/attachmentCleanup.ts).
  await deleteForMessage(msgId);
  await db.delete(messages).where(eq(messages.id, msgId));
  // the author's quota just got room back
  if (existing.authorId) void sendUsageToUser(existing.authorId).catch(() => {});
  await recordConversationActivity(existing.conversationId);
  if (!isAuthor) {
    // moderation, so it leaves a trail — ids only, never the message body
    await recordAudit({
      actor: { id: p.userId, username: p.name }, action: 'message.delete', targetType: 'message', targetId: String(msgId),
      detail: { conversationId: existing.conversationId, authorId: existing.authorId },
    }).catch((err) => log.error('message.delete', err));
  }
  await broadcastToConversationMembers(existing.conversationId, {
    t: 'chat-deleted',
    conversationId: existing.conversationId,
    msgId,
  });
  return null;
}

async function handleChatDelete(socket: AppSocket, msg: { msgId?: unknown; requestId?: unknown }): Promise<void> {
  const p = participants.get(socket.participantId ?? '');
  if (!p || p.socket !== socket) return;
  answerAction(socket, msg, await deleteMessage(p, msg));
}


// No DB write at all — pure ephemeral fan-out, same spirit as
// speaking/deafened (realtime/participants.ts). The client is responsible
// for throttling emits (see MessageComposer.tsx); this only relays.
async function handleTyping(socket: AppSocket, msg: { conversationId?: string; value?: unknown }): Promise<void> {
  const p = participants.get(socket.participantId ?? '');
  if (!p || p.socket !== socket) return;
  const conversationId = conversationIdFrom(msg);
  if (!conversationId || !(await conversationExistsForUser(conversationId, p.userId))) return;
  if (!(await assertCanWriteToConversation(socket, conversationId, p.userId))) return;
  await broadcastToConversationMembers(conversationId, {
    t: 'typing',
    conversationId,
    userId: p.userId,
    value: !!msg.value,
  });
}

export const handlers: HandlerTable = {
  'conversation-open': handleConversationOpen,
  'load-more-messages': handleLoadMoreMessages,
  'load-messages-around': handleLoadMessagesAround,
  'load-messages-after': handleLoadMessagesAfter,
  'message-search': handleMessageSearch,
  chat: handleChat,
  'chat-delete': handleChatDelete,
  'chat-edit': handleChatEdit,
  'chat-react': handleChatReact,
  typing: handleTyping,
};

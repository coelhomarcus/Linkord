import fs from 'node:fs/promises';
import { eq, sql } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../../config/env.js';
import { db } from '../../db/client.js';
import { attachments as attachmentsTable, messages, type Attachment } from '../../db/schema.js';
import { sendJson, sendError, jsonBody } from '../../http/respond.js';
import { parseCookies } from '../../http/cookies.js';
import { resolveSession } from '../auth/session.js';
import { broadcastToConversationMembers, conversationExistsForUser, getDirectPeerId, touchConversation, recordConversationActivity } from '../conversations/conversationsRepository.js';
import { canSendDirectMessage } from '../friendships/friendshipsRepository.js';
import { newId, filePathFor } from './attachmentStorage.js';
import { generateThumbnail, THUMBNAIL_SOURCE_MIME_TYPES } from './attachmentThumbnails.js';
import { getUsage, sendUsageToUser } from './attachmentQuota.js';
import { exceedsLimit, getUserStorageBytes, limitMax } from '../limits/limits.js';
import {
  tmpDirFor, manifestPathFor, chunkPathFor, readManifest, expectedChunkLength, assembleChunks, sanitizeFileName,
  reserveUpload, releaseUpload, getReservedBytes, getReservedBytesForUser, withInitLock, completingUploads,
} from './uploadSession.js';
import type { UploadManifest } from './uploadSession.js';
import { logger } from '../../lib/logger.js';

const log = logger.child({ component: 'attachments' });

// The Fastify HTTP handlers for the chunked-upload lifecycle — the on-disk
// session mechanics (manifest, chunk paths, quota reservation, the stale
// sweep) live in uploadSession.ts, the only half app/bootstrap.ts and the
// test suite need.

/** Step 1/3 — declares the file before any bytes are sent, so an invalid
 * conversation/quota/size fails fast. Server decides chunkSize; the client
 * never hardcodes it. */
export async function handleAttachmentInit(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const cookies = parseCookies(request.headers.cookie || '');
  const sess = await resolveSession(cookies[config.SESSION_COOKIE]);
  if (!sess) return sendError(reply, 401, 'unauthenticated', 'Não autenticado.');

  const body = jsonBody(request.body);
  const conversationId = String(body.conversationId || '');
  if (!conversationId || !(await conversationExistsForUser(conversationId, sess.userId))) {
    return sendError(reply, 404, 'conversation_not_found', 'Conversa não encontrada.');
  }
  // §4.3: "anexar" is on the restricted-contact list — same gate as
  // messages.ts's chat/react/typing. No-ops for a group (getDirectPeerId
  // returns null there).
  const peerId = await getDirectPeerId(conversationId, sess.userId);
  if (peerId && !(await canSendDirectMessage(sess.userId, peerId))) {
    return sendError(reply, 403, 'relationship_required', 'Vocês precisam ser amigos pra enviar arquivos por aqui.');
  }

  const fileName = sanitizeFileName(body.fileName);
  const mimeType = String(body.mimeType || 'application/octet-stream').split(';')[0]!.trim() || 'application/octet-stream';
  const caption = String(body.caption || '').trim().slice(0, config.MAX_CHAT_LEN);

  const totalSize = Number(body.totalSize);
  if (!Number.isInteger(totalSize) || totalSize <= 0 || totalSize > config.MAX_ATTACHMENT_BYTES) {
    return sendError(reply, 400, 'invalid_size', 'Tamanho de arquivo inválido.');
  }

  const uploadId = newId();

  // reserve this upload's declared size against the quota BEFORE any chunk
  // bytes can be sent — see uploadSession.ts#pendingUploadBytes for why this
  // has to be check-then-reserve, atomically, rather than just checking
  // getUsage().
  const reserved = await withInitLock(async (): Promise<'ok' | 'storage_full' | 'quota_exceeded'> => {
    // the account's own quota first: what it already stored + what it already
    // has in flight + this file. Then the instance-wide ceiling.
    const own = (await getUserStorageBytes(sess.userId)) + getReservedBytesForUser(sess.userId);
    if (exceedsLimit(own, limitMax('storage'), totalSize)) return 'quota_exceeded';
    const usage = await getUsage();
    if (usage.totalBytes + getReservedBytes() + totalSize > config.MAX_STORAGE_BYTES) return 'storage_full';
    reserveUpload(uploadId, totalSize, sess.userId);
    return 'ok';
  });
  if (reserved === 'quota_exceeded') {
    log.info('upload refused: account storage quota', { userId: sess.userId, totalSize });
    return sendError(reply, 400, 'quota_exceeded', 'Você atingiu o seu limite de armazenamento. Apague arquivos seus antes de enviar mais.');
  }
  if (reserved === 'storage_full') {
    log.warn('upload refused: instance storage is full', { userId: sess.userId, totalSize });
    return sendError(reply, 400, 'storage_full', 'Armazenamento cheio (30GB no total). Apague arquivos antigos antes de enviar mais.');
  }

  const chunkSize = config.UPLOAD_CHUNK_BYTES;
  const totalChunks = Math.ceil(totalSize / chunkSize);
  try {
    await fs.mkdir(tmpDirFor(uploadId), { recursive: true });
    await fs.writeFile(manifestPathFor(uploadId), JSON.stringify({
      uploadId, userId: sess.userId, conversationId, fileName, mimeType, totalSize, caption,
      chunkSize, totalChunks, createdAt: new Date().toISOString(),
    } satisfies UploadManifest));
  } catch (err) {
    releaseUpload(uploadId);
    throw err;
  }

  log.debug('upload started', { uploadId, userId: sess.userId, conversationId, totalSize, totalChunks });
  sendJson(reply, 201, { uploadId, chunkSize, totalChunks });
}

/** Step 2/3 — one chunk (up to UPLOAD_CHUNK_BYTES, last one may be
 * smaller). Idempotent: re-sending the same index is a safe retry. */
export async function handleAttachmentChunk(request: FastifyRequest<{ Params: { id: string; index: string } }>, reply: FastifyReply): Promise<void> {
  const uploadId = request.params.id;
  const index = Number(request.params.index);
  const cookies = parseCookies(request.headers.cookie || '');
  const sess = await resolveSession(cookies[config.SESSION_COOKIE]);
  if (!sess) return sendError(reply, 401, 'unauthenticated', 'Não autenticado.');

  const manifest = await readManifest(uploadId);
  if (!manifest || manifest.userId !== sess.userId) return sendError(reply, 404, 'upload_not_found', 'Upload não encontrado.');
  if (!Number.isInteger(index) || index < 0 || index >= manifest.totalChunks) {
    return sendError(reply, 400, 'invalid_index', 'Índice de pedaço inválido.');
  }

  // raw Buffer body — content-type parser for this route is swapped in
  // registerAttachmentRoutes (attachments.ts); bodyLimit caps it, but the
  // exact length still needs checking here (the last chunk is always
  // smaller).
  const expected = expectedChunkLength(manifest, index);
  const buffer = request.body as Buffer;
  if (buffer.length !== expected) return sendError(reply, 400, 'chunk_size_mismatch', 'Tamanho do pedaço não bate com o esperado.');

  await fs.writeFile(chunkPathFor(uploadId, index), buffer);
  sendJson(reply, 200, { received: index });
}

/** Step 3/3 — confirms all chunks arrived, streams them into the final file
 * (never fully in memory), then creates the message/attachment row. Chunks
 * are only deleted from disk AFTER the transaction commits. */
export async function handleAttachmentComplete(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply): Promise<void> {
  const uploadId = request.params.id;
  const cookies = parseCookies(request.headers.cookie || '');
  const sess = await resolveSession(cookies[config.SESSION_COOKIE]);
  if (!sess) return sendError(reply, 401, 'unauthenticated', 'Não autenticado.');

  const manifest = await readManifest(uploadId);
  if (!manifest || manifest.userId !== sess.userId) return sendError(reply, 404, 'upload_not_found', 'Upload não encontrado.');

  // optional — present only when this file is the 2nd-4th attachment of a
  // message whose FIRST attachment already created it (see
  // chunkedUpload.ts/RoomProvider.tsx#sendAttachments). The client now
  // always sends a JSON body here (possibly `{}`), even for the common
  // single-attachment case.
  const body = jsonBody(request.body);
  let targetMsgId: number | null = null;
  if (body.targetMsgId != null) {
    targetMsgId = Number(body.targetMsgId);
    if (!Number.isFinite(targetMsgId)) return sendError(reply, 400, 'invalid_target', 'targetMsgId inválido.');
    const [existing] = await db.select().from(messages).where(eq(messages.id, targetMsgId)).limit(1);
    if (!existing) return sendError(reply, 404, 'target_message_not_found', 'Mensagem de destino não encontrada.');
    if (existing.authorId !== sess.userId) return sendError(reply, 403, 'not_your_message', 'Você só pode anexar arquivos às suas próprias mensagens.');
    if (existing.kind !== 'text') return sendError(reply, 400, 'invalid_target', 'Não dá para anexar arquivos a esse tipo de mensagem.');
    if (existing.conversationId !== manifest.conversationId) return sendError(reply, 400, 'conversation_mismatch', 'A conversa não corresponde ao upload.');
    if (Date.now() - existing.createdAt.getTime() > config.ATTACH_TO_MESSAGE_WINDOW_MS) {
      return sendError(reply, 400, 'target_message_too_old', 'A mensagem de destino é antiga demais para receber mais anexos.');
    }
  }

  if (completingUploads.has(uploadId)) return sendError(reply, 409, 'already_completing', 'O upload já está sendo finalizado.');
  completingUploads.add(uploadId);

  try {
    for (let i = 0; i < manifest.totalChunks; i++) {
      try {
        await fs.access(chunkPathFor(uploadId, i));
      } catch {
        return sendError(reply, 400, 'incomplete_upload', 'Faltam pedaços do arquivo.');
      }
    }
    let receivedTotal = 0;
    for (let i = 0; i < manifest.totalChunks; i++) {
      receivedTotal += (await fs.stat(chunkPathFor(uploadId, i))).size;
    }
    if (receivedTotal !== manifest.totalSize) return sendError(reply, 400, 'size_mismatch', 'O tamanho recebido não corresponde ao declarado.');

    const usage = await getUsage();
    if (usage.totalBytes + manifest.totalSize > config.MAX_STORAGE_BYTES) {
      return sendError(reply, 400, 'storage_full', 'Armazenamento cheio (30GB no total). Apague arquivos antigos antes de enviar mais.');
    }

    const destPath = filePathFor(uploadId);
    let row: Attachment;
    let message: typeof messages.$inferSelect | null = null;
    try {
      await assembleChunks(uploadId, manifest, destPath);
      if (targetMsgId != null) {
        const targetId = targetMsgId;
        row = await db.transaction(async (tx) => {
          // locks the message row so two concurrent completes racing to
          // attach to the SAME message can't both pass the count check
          // below before either commits.
          await tx.execute(sql`select id from ${messages} where ${messages.id} = ${targetId} for update`);
          const existingCount = (await tx.select({ id: attachmentsTable.id }).from(attachmentsTable).where(eq(attachmentsTable.messageId, targetId))).length;
          if (existingCount >= config.MAX_ATTACHMENTS_PER_MESSAGE) {
            throw Object.assign(new Error('too_many_attachments'), { code: 'too_many_attachments' });
          }
          const [attachmentRow] = await tx.insert(attachmentsTable).values({
            id: uploadId, messageId: targetId, fileName: manifest.fileName, mimeType: manifest.mimeType, size: manifest.totalSize,
          }).returning();
          return attachmentRow!;
        });
      } else {
        const inserted = await db.transaction(async (tx) => {
          const [messageRow] = await tx.insert(messages).values({
            conversationId: manifest.conversationId, authorId: sess.userId, text: manifest.caption,
          }).returning();
          const [attachmentRow] = await tx.insert(attachmentsTable).values({
            id: uploadId, messageId: messageRow!.id, fileName: manifest.fileName, mimeType: manifest.mimeType, size: manifest.totalSize,
          }).returning();
          return { messageRow: messageRow!, attachmentRow: attachmentRow! };
        });
        row = inserted.attachmentRow;
        message = inserted.messageRow;
      }
    } catch (err) {
      // keep the CHUNKS on purpose — client can retry complete() without
      // re-uploading everything; only the (partial/invalid) final file is
      // discarded.
      await fs.unlink(destPath).catch(() => {});
      if (err instanceof Error && (err as { code?: string }).code === 'too_many_attachments') {
        return sendError(reply, 400, 'too_many_attachments', 'Essa mensagem já tem o máximo de anexos.');
      }
      throw err;
    }

    // only deleted after a successful commit; a failed delete here just
    // logs — sweepStaleUploads cleans it up later.
    await fs.rm(tmpDirFor(uploadId), { recursive: true, force: true })
      .catch((err) => log.error('failed to delete chunks after assembly', err));
    releaseUpload(uploadId);

    // Best-effort: a thumbnail that fails to generate/save just means this
    // attachment serves its full original for the inline preview too — never
    // fails the upload itself.
    let thumbId: string | null = null;
    if (THUMBNAIL_SOURCE_MIME_TYPES.has(row.mimeType)) {
      const thumb = await generateThumbnail(destPath);
      if (thumb) {
        const newThumbId = newId();
        try {
          await fs.writeFile(filePathFor(newThumbId), thumb.buffer);
          await db.insert(attachmentsTable).values({
            id: newThumbId, messageId: row.messageId, fileName: row.fileName, mimeType: thumb.mime, size: thumb.buffer.length, isThumbnail: true,
          });
          await db.update(attachmentsTable).set({ thumbId: newThumbId }).where(eq(attachmentsTable.id, row.id));
          thumbId = newThumbId;
        } catch (err) {
          log.warn('failed to save thumbnail', { err: err instanceof Error ? err.message : String(err) });
          await fs.unlink(filePathFor(newThumbId)).catch(() => {});
        }
      }
    }

    const attachmentPayload = { id: row.id, name: row.fileName, mime: row.mimeType, size: row.size, ...(thumbId ? { thumbId } : {}) };
    if (message) {
      const chatMessage = {
        msgId: message.id,
        conversationId: message.conversationId,
        id: message.authorId,
        name: sess.displayName,
        avatar: sess.avatar,
        text: message.text,
        ts: message.createdAt.getTime(),
        attachments: [attachmentPayload],
      };
      await touchConversation(message.conversationId, message.createdAt);
      await broadcastToConversationMembers(message.conversationId, { t: 'chat', message: chatMessage });
      await sendUsageToUser(sess.userId);
      log.info('upload completed', { uploadId, userId: sess.userId, conversationId: manifest.conversationId, bytes: manifest.totalSize });
      sendJson(reply, 201, { message: chatMessage });
    } else {
      // an EXISTING message just got another attachment (2nd-4th file of a
      // multi-file upload) — not a new message, so this doesn't touch
      // lastMessageAt either (see conversationsRepository.ts#recordConversationActivity).
      await recordConversationActivity(manifest.conversationId);
      await broadcastToConversationMembers(manifest.conversationId, {
        t: 'chat-attachment-added',
        conversationId: manifest.conversationId,
        msgId: targetMsgId!,
        attachment: attachmentPayload,
      });
      await sendUsageToUser(sess.userId);
      log.info('upload completed', { uploadId, userId: sess.userId, conversationId: manifest.conversationId, bytes: manifest.totalSize, attachedTo: targetMsgId });
      sendJson(reply, 201, { attachment: attachmentPayload });
    }
  } finally {
    completingUploads.delete(uploadId);
  }
}

/** Cancels an in-progress upload session — deletes chunks immediately
 * instead of waiting for the sweep. Idempotent. */
export async function handleAttachmentCancel(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply): Promise<void> {
  const uploadId = request.params.id;
  const cookies = parseCookies(request.headers.cookie || '');
  const sess = await resolveSession(cookies[config.SESSION_COOKIE]);
  if (!sess) return sendError(reply, 401, 'unauthenticated', 'Não autenticado.');

  const manifest = await readManifest(uploadId);
  if (manifest && manifest.userId === sess.userId) {
    await fs.rm(tmpDirFor(uploadId), { recursive: true, force: true }).catch(() => {});
    releaseUpload(uploadId);
  }
  sendJson(reply, 200, { ok: true });
}

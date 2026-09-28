import fs from 'node:fs/promises';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../../config/env.js';
import { sendJson, sendError, jsonBody } from '../../http/respond.js';
import { parseCookies } from '../../http/cookies.js';
import { resolveSession } from '../auth/session.js';
import { conversationExistsForUser, getDirectPeerId } from '../conversations/conversationsRepository.js';
import { canSendDirectMessage } from '../friendships/friendshipsRepository.js';
import { newId, filePathFor } from './attachmentStorage.js';
import { generateThumbnail, readImageDimensions, THUMBNAIL_SOURCE_MIME_TYPES } from './attachmentThumbnails.js';
import { discardStaged, findOwnedStaged, stageFile } from './stagedAttachments.js';
import type { StagedAttachment } from '../../db/schema.js';
import { getUsage, sendUsageToUser } from './attachmentQuota.js';
import { exceedsLimit, getUserStorageBytes, limitMax } from '../limits/limits.js';
import {
  tmpDirFor, manifestPathFor, chunkPathFor, readManifest, expectedChunkLength, assembleChunks, sanitizeFileName,
  reserveUpload, releaseUpload, getReservedBytes, getReservedBytesForUser, withInitLock, completingUploads,
} from './uploadSession.js';
import type { UploadManifest } from './uploadSession.js';
import * as floodControl from '../../realtime/floodControl.js';
import { logger } from '../../lib/logger.js';

const log = logger.child({ component: 'attachments' });

// The Fastify HTTP handlers for the chunked-upload lifecycle — the on-disk
// session mechanics (manifest, chunk paths, quota reservation, the stale
// sweep) live in uploadSession.ts, the only half app/bootstrap.ts and the
// test suite need.

// Nothing capped how often an account could START a new upload — the
// storage quota below only bounds cumulative DECLARED size, so many tiny
// (or even zero-progress, never-completed) uploads cost real disk I/O
// (mkdir + a manifest write each) with no cost against that quota at all.
// Rate-limiting init alone is enough: every chunk belongs to an
// already-approved session, so gating new sessions here bounds the whole
// pipeline. Generous — real usage can burst (dragging several files into
// one message, or several messages in a row).
const ATTACHMENT_INIT_LIMIT = { windowMs: 60_000, max: 20 };

/** Step 1/3 — declares the file before any bytes are sent, so an invalid
 * conversation/quota/size fails fast. Server decides chunkSize; the client
 * never hardcodes it. */
export async function handleAttachmentInit(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const cookies = parseCookies(request.headers.cookie || '');
  const sess = await resolveSession(cookies[config.SESSION_COOKIE]);
  if (!sess) return sendError(reply, 401, 'unauthenticated', 'Não autenticado.');

  if (!floodControl.allow(`attachment-init:${sess.userId}`, ATTACHMENT_INIT_LIMIT)) {
    // the batch client waits exactly this long and tries again
    reply.header('Retry-After', String(Math.ceil(floodControl.retryAfterMs(`attachment-init:${sess.userId}`, ATTACHMENT_INIT_LIMIT) / 1000) || 1));
    return sendError(reply, 429, 'rate_limited', 'Muitos envios em pouco tempo. Tente de novo em instantes.');
  }

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
      uploadId, userId: sess.userId, conversationId, fileName, mimeType, totalSize,
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
 * (never fully in memory), then stages it (see completeStaged): nothing is
 * published to anyone here. The message that carries it is created later,
 * with the whole batch, by a correlated `chat` send (messages.ts). */
export async function handleAttachmentComplete(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply): Promise<void> {
  const uploadId = request.params.id;
  const cookies = parseCookies(request.headers.cookie || '');
  const sess = await resolveSession(cookies[config.SESSION_COOKIE]);
  if (!sess) return sendError(reply, 401, 'unauthenticated', 'Não autenticado.');

  const manifest = await readManifest(uploadId);
  if (!manifest) {
    // a retried complete whose first reply got lost: the manifest is gone
    // because it already succeeded
    const staged = await findOwnedStaged(uploadId, sess.userId);
    if (staged) return sendJson(reply, 200, { staged: stagedPayload(staged) });
    return sendError(reply, 404, 'upload_not_found', 'Upload não encontrado.');
  }
  if (manifest.userId !== sess.userId) return sendError(reply, 404, 'upload_not_found', 'Upload não encontrado.');

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

    return await completeStaged(reply, manifest, sess.userId);
  } finally {
    completingUploads.delete(uploadId);
  }
}

function stagedPayload(row: StagedAttachment) {
  return {
    id: row.id, name: row.fileName, mime: row.mimeType, size: row.size, ...(row.thumbId ? { thumbId: row.thumbId } : {}),
    ...(row.width && row.height ? { width: row.width, height: row.height } : {}),
  };
}

/** The staged half of complete: the file (and its thumbnail) end up on disk
 * and in staged_attachments, counted against the quota, visible to no one. */
async function completeStaged(reply: FastifyReply, manifest: UploadManifest, userId: string): Promise<void> {
  const { uploadId } = manifest;
  const destPath = filePathFor(uploadId);
  let thumb: { id: string; mime: string; size: number } | null = null;
  let dims: { width: number; height: number } | null = null;
  let staged: StagedAttachment;
  try {
    await assembleChunks(uploadId, manifest, destPath);
    if (THUMBNAIL_SOURCE_MIME_TYPES.has(manifest.mimeType)) {
      dims = await readImageDimensions(destPath);
      const generated = await generateThumbnail(destPath);
      if (generated) {
        const thumbId = newId();
        try {
          await fs.writeFile(filePathFor(thumbId), generated.buffer);
          thumb = { id: thumbId, mime: generated.mime, size: generated.buffer.length };
        } catch (err) {
          log.warn('failed to save thumbnail', { err: err instanceof Error ? err.message : String(err) });
          await fs.unlink(filePathFor(thumbId)).catch(() => {});
        }
      }
    }
    staged = await stageFile({
      id: uploadId, ownerId: userId, conversationId: manifest.conversationId,
      fileName: manifest.fileName, mimeType: manifest.mimeType, size: manifest.totalSize,
      thumbId: thumb?.id ?? null, thumbMimeType: thumb?.mime ?? null, thumbSize: thumb?.size ?? null,
      width: dims?.width ?? null, height: dims?.height ?? null,
    });
  } catch (err) {
    // chunks stay, so complete can be retried without re-uploading
    await fs.unlink(destPath).catch(() => {});
    if (thumb) await fs.unlink(filePathFor(thumb.id)).catch(() => {});
    throw err;
  }
  await fs.rm(tmpDirFor(uploadId), { recursive: true, force: true })
    .catch((err) => log.error('failed to delete chunks after assembly', err));
  releaseUpload(uploadId);
  await sendUsageToUser(userId);
  log.info('upload staged', { uploadId, userId, conversationId: manifest.conversationId, bytes: manifest.totalSize });
  sendJson(reply, 201, { staged: stagedPayload(staged) });
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
  // or a file that finished staging and was then dropped from the batch
  if (await discardStaged(uploadId, sess.userId)) await sendUsageToUser(sess.userId);
  sendJson(reply, 200, { ok: true });
}

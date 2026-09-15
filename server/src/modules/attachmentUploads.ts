import fs from 'node:fs/promises';
import fsStreams from 'node:fs'; // only for createReadStream/createWriteStream (chunk assembly), see assembleChunks
import path from 'node:path';
import { eq, sql } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config/env.js';
import { db } from '../db/client.js';
import { attachments as attachmentsTable, messages, type Attachment } from '../db/schema.js';
import { sendJson, sendError, jsonBody } from '../http/respond.js';
import { parseCookies } from '../http/cookies.js';
import { resolveSession } from './auth/session.js';
import { broadcastToConversationMembers, conversationExistsForUser, touchConversation, recordConversationActivity } from './conversations.js';
import { newId, filePathFor } from './attachmentStorage.js';
import { generateThumbnail, THUMBNAIL_SOURCE_MIME_TYPES } from './attachmentThumbnails.js';
import { getUsage, broadcastUsage } from './attachmentQuota.js';

export async function ensureUploadDir(): Promise<void> {
  await fs.mkdir(config.UPLOAD_DIR, { recursive: true });
}

export function sanitizeFileName(raw: unknown): string {
  const s = String(raw == null ? '' : raw).trim().replace(/[\r\n/\\]/g, '_').slice(0, 200);
  return s || 'arquivo';
}

// Chunked upload for MAX_ATTACHMENT_BYTES (2GB): a single POST that size
// wouldn't survive most proxies or be safe to buffer in memory. Upload
// session state lives on disk only (no DB table) — deployment is single-
// instance, so there's no need to share it across processes. `uploadId`
// becomes the final attachment id directly, no rename step.

interface UploadManifest {
  uploadId: string;
  userId: string;
  conversationId: string;
  fileName: string;
  mimeType: string;
  totalSize: number;
  caption: string;
  chunkSize: number;
  totalChunks: number;
  createdAt: string;
}

function tmpDirFor(uploadId: string): string {
  return path.join(config.UPLOAD_DIR, 'tmp', uploadId);
}

function manifestPathFor(uploadId: string): string {
  return path.join(tmpDirFor(uploadId), 'manifest.json');
}

function chunkPathFor(uploadId: string, index: number): string {
  // zero-padded so alphabetical sort matches numeric sort
  return path.join(tmpDirFor(uploadId), String(index).padStart(6, '0'));
}

/** null if missing or corrupt — caller treats that as 404. */
async function readManifest(uploadId: string): Promise<UploadManifest | null> {
  try {
    return JSON.parse(await fs.readFile(manifestPathFor(uploadId), 'utf8'));
  } catch {
    return null;
  }
}

/** All chunks are chunkSize except the last, which is the remainder. */
export function expectedChunkLength(manifest: UploadManifest, index: number): number {
  return index === manifest.totalChunks - 1
    ? manifest.totalSize - manifest.chunkSize * (manifest.totalChunks - 1)
    : manifest.chunkSize;
}

/** Streams chunks in order into the final file — never Buffer.concat, which
 * is exactly what a 2GB upload needs to avoid. */
async function assembleChunks(uploadId: string, manifest: UploadManifest, destPath: string): Promise<void> {
  const writeStream = fsStreams.createWriteStream(destPath);
  try {
    for (let i = 0; i < manifest.totalChunks; i++) {
      await new Promise<void>((resolve, reject) => {
        const readStream = fsStreams.createReadStream(chunkPathFor(uploadId, i));
        readStream.on('error', reject);
        writeStream.on('error', reject);
        readStream.pipe(writeStream, { end: false });
        readStream.on('end', resolve);
      });
    }
    await new Promise<void>((resolve, reject) => {
      writeStream.end((err: NodeJS.ErrnoException | null | undefined) => (err ? reject(err) : resolve()));
    });
  } catch (err) {
    writeStream.destroy();
    throw err;
  }
}

// uploadId -> declared totalSize, for every upload session that has chunks
// on disk but isn't committed to the DB yet. getUsage() only sums committed
// rows, so without this an attacker could open many parallel init()s — each
// one sees the same (unchanged) committed total and passes the quota check
// on its own — then upload chunks for all of them at once, filling the disk
// far past MAX_STORAGE_BYTES before any single one reaches complete(). This
// map is the running total of storage already "promised" to in-flight
// sessions; init() checks committed + reserved + this-upload's size against
// the quota, atomically (see withInitLock). Entries are released only when
// the session's chunks are actually gone from disk (cancel, a *successful*
// complete, or the stale sweep) — never on a failed complete, since chunks
// are deliberately kept there for the client to retry. Rebuilt from disk at
// boot by sweepStaleUploads, since a restart clears this map but not the
// chunks already written.
const pendingUploadBytes = new Map<string, number>();

/** Cleans up abandoned upload sessions (tab closed / browser crash before
 * complete or cancel) — called at boot and hourly. Also re-declares the
 * quota reservation (see pendingUploadBytes) for every session still on
 * disk: at boot this REBUILDS the in-memory map from scratch (a restart
 * wipes it, but chunks already on disk don't disappear), and on the hourly
 * runs it's a harmless no-op re-set. */
export async function sweepStaleUploads(): Promise<void> {
  const tmpRoot = path.join(config.UPLOAD_DIR, 'tmp');
  let ids: string[];
  try {
    ids = await fs.readdir(tmpRoot);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw err;
  }
  for (const id of ids) {
    const dir = path.join(tmpRoot, id);
    let createdAtMs: number;
    let totalSize: number | undefined;
    try {
      const manifest: UploadManifest = JSON.parse(await fs.readFile(path.join(dir, 'manifest.json'), 'utf8'));
      createdAtMs = new Date(manifest.createdAt).getTime();
      totalSize = manifest.totalSize;
    } catch {
      // manifest missing/corrupt — fall back to the folder's creation time
      // so it can still be swept.
      try {
        createdAtMs = (await fs.stat(dir)).birthtimeMs;
      } catch {
        continue;
      }
    }
    if (Date.now() - createdAtMs > config.UPLOAD_SESSION_TTL_MS) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
      pendingUploadBytes.delete(id);
    } else if (totalSize != null) {
      pendingUploadBytes.set(id, totalSize);
    }
  }
}

function getReservedBytes(): number {
  let sum = 0;
  for (const bytes of pendingUploadBytes.values()) sum += bytes;
  return sum;
}

// Serializes the check-then-reserve section of init() across concurrent
// requests (single-instance deployment, same assumption as completingUploads
// below) — without this, two init()s could both read the same
// committed+reserved total before either adds its own reservation, letting
// both through even though their combined size exceeds the quota.
let initLock: Promise<unknown> = Promise.resolve();
function withInitLock<T>(fn: () => Promise<T>): Promise<T> {
  const result = initLock.then(fn, fn);
  initLock = result.then(() => undefined, () => undefined);
  return result;
}

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

  const fileName = sanitizeFileName(body.fileName);
  const mimeType = String(body.mimeType || 'application/octet-stream').split(';')[0]!.trim() || 'application/octet-stream';
  const caption = String(body.caption || '').trim().slice(0, config.MAX_CHAT_LEN);

  const totalSize = Number(body.totalSize);
  if (!Number.isInteger(totalSize) || totalSize <= 0 || totalSize > config.MAX_ATTACHMENT_BYTES) {
    return sendError(reply, 400, 'invalid_size', 'Tamanho de arquivo inválido.');
  }

  const uploadId = newId();

  // reserve this upload's declared size against the quota BEFORE any chunk
  // bytes can be sent — see pendingUploadBytes above for why this has to be
  // check-then-reserve, atomically, rather than just checking getUsage().
  const reserved = await withInitLock(async () => {
    const usage = await getUsage();
    if (usage.totalBytes + getReservedBytes() + totalSize > config.MAX_STORAGE_BYTES) return false;
    pendingUploadBytes.set(uploadId, totalSize);
    return true;
  });
  if (!reserved) {
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
    pendingUploadBytes.delete(uploadId);
    throw err;
  }

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

// serializes concurrent complete() calls for the SAME uploadId — without
// this, a duplicate client retry could try to assemble/write the same final
// file twice. Process-lifetime only (correctly resets on restart).
const completingUploads = new Set<string>();

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
      .catch((err) => console.error('[attachments] falha ao apagar chunks apos montagem:', err instanceof Error ? err.stack : err));
    pendingUploadBytes.delete(uploadId);

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
          console.warn('[attachments] falha ao salvar miniatura:', err instanceof Error ? err.message : err);
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
      await broadcastUsage();
      sendJson(reply, 201, { message: chatMessage });
    } else {
      // an EXISTING message just got another attachment (2nd-4th file of a
      // multi-file upload) — not a new message, so this doesn't touch
      // lastMessageAt either (see conversations.ts#recordConversationActivity).
      await recordConversationActivity(manifest.conversationId);
      await broadcastToConversationMembers(manifest.conversationId, {
        t: 'chat-attachment-added',
        conversationId: manifest.conversationId,
        msgId: targetMsgId!,
        attachment: attachmentPayload,
      });
      await broadcastUsage();
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
    pendingUploadBytes.delete(uploadId);
  }
  sendJson(reply, 200, { ok: true });
}

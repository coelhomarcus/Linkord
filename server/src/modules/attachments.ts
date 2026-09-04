import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import fsStreams from 'node:fs'; // only for createReadStream/createWriteStream (chunk assembly), see assembleChunks
import path from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { eq, and, inArray, isNull, isNotNull, sql } from 'drizzle-orm';
import { config } from '../config/env.js';
import { db } from '../db/client.js';
import { attachments as attachmentsTable, messages, type Attachment } from '../db/schema.js';
import { broadcast } from '../realtime/participants.js';
import { sendJson, sendError, jsonBody } from '../http/respond.js';
import { parseCookies } from '../http/cookies.js';
import { resolveSession } from './auth/session.js';
import { channelExists } from './channels.js';

// Chat attachments: max one per message, stored on disk keyed by a uuid (no
// extension — real mime type lives in the mime_type column, never trust the
// name). Quota is computed live from the table, not a cached counter, so it
// can't drift from what's actually on disk. Only a known list of image/
// video/audio mimes is served inline; everything else forces a download
// (prevents an uploaded .svg/.html from executing script on our own origin
// — see serveUpload).
const INLINE_MIME_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp',
  'video/mp4', 'video/webm', 'video/ogg',
  'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/mp4',
]);
const ID_RE = /^[0-9a-f]{32}$/; // crypto.randomUUID() without dashes, see newId
const AVATAR_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
// only matches our own upload format (see newId) — an external URL just
// doesn't match, treated as "not ours," not an error.
const AVATAR_URL_RE = /^\/uploads\/([0-9a-f]{32})$/;

function newId(): string {
  return crypto.randomUUID().replace(/-/g, '');
}

function filePathFor(id: string): string {
  return path.join(config.UPLOAD_DIR, id);
}

export async function ensureUploadDir(): Promise<void> {
  await fs.mkdir(config.UPLOAD_DIR, { recursive: true });
}

// Chunked upload for MAX_ATTACHMENT_BYTES (2GB): a single POST that size
// wouldn't survive most proxies or be safe to buffer in memory. Upload
// session state lives on disk only (no DB table) — deployment is single-
// instance, so there's no need to share it across processes. `uploadId`
// becomes the final attachment id directly, no rename step.

interface UploadManifest {
  uploadId: string;
  userId: string;
  channelId: string;
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

/** Cleans up abandoned upload sessions (tab closed / browser crash before
 * complete or cancel) — called at boot and hourly. */
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
    try {
      const manifest: UploadManifest = JSON.parse(await fs.readFile(path.join(dir, 'manifest.json'), 'utf8'));
      createdAtMs = new Date(manifest.createdAt).getTime();
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
    }
  }
}

export interface UsageInfo {
  totalBytes: number;
  totalFiles: number;
  maxBytes: number;
}

/** Always computed live (sum/count the table) — never drifts from disk.
 * Only counts chat attachments (messageId set); avatars are excluded from
 * the 30GB quota on purpose. */
export async function getUsage(): Promise<UsageInfo> {
  const [row] = await db
    .select({ totalBytes: sql<number>`coalesce(sum(${attachmentsTable.size}), 0)`, totalFiles: sql<number>`count(*)` })
    .from(attachmentsTable)
    .where(isNotNull(attachmentsTable.messageId));
  return { totalBytes: Number(row!.totalBytes), totalFiles: Number(row!.totalFiles), maxBytes: config.MAX_STORAGE_BYTES };
}

async function broadcastUsage(): Promise<void> {
  broadcast({ t: 'storage-usage', ...(await getUsage()) });
}

/** One query for all messages' attachments (avoids N+1). */
export async function getByMessageIds(messageIds: number[]): Promise<Map<number, Attachment>> {
  const map = new Map<number, Attachment>();
  if (!messageIds.length) return map;
  const rows = await db.select().from(attachmentsTable).where(inArray(attachmentsTable.messageId, messageIds));
  for (const row of rows) if (row.messageId !== null) map.set(row.messageId, row);
  return map;
}

/** Deletes the on-disk file only — the DB row disappears via CASCADE when
 * the message is deleted right after (see modules/chat.ts). Postgres
 * doesn't know about the file, so that part has to happen separately. */
export async function deleteForMessage(messageId: number): Promise<void> {
  const [row] = await db.select().from(attachmentsTable).where(eq(attachmentsTable.messageId, messageId)).limit(1);
  if (!row) return;
  await fs.unlink(filePathFor(row.id)).catch((err: NodeJS.ErrnoException) => { if (err.code !== 'ENOENT') throw err; });
}

/** Same idea in bulk — deleting a channel CASCADEs messages/attachments in
 * Postgres without going through deleteForMessage, so this exists purely to
 * avoid orphaned files. Called by modules/channels.ts before the delete. */
export async function deleteForChannel(channelId: string): Promise<void> {
  const rows = await db
    .select({ id: attachmentsTable.id })
    .from(attachmentsTable)
    .innerJoin(messages, eq(attachmentsTable.messageId, messages.id))
    .where(eq(messages.channelId, channelId));
  await Promise.all(rows.map((row) => fs.unlink(filePathFor(row.id)).catch((err: NodeJS.ErrnoException) => { if (err.code !== 'ENOENT') throw err; })));
}

/** Deletes the OLD avatar file+row when an account switches to a new one
 * (see realtime/participants.ts#handleProfile) — otherwise old avatars pile
 * up orphaned forever. No-ops for an external URL or empty value.
 * `isNull(messageId)` is a second guard so a manipulated value could never
 * delete a real chat attachment. */
export async function deleteAvatarFile(avatarValue: unknown): Promise<void> {
  const match = AVATAR_URL_RE.exec(String(avatarValue == null ? '' : avatarValue));
  if (!match) return;
  const id = match[1]!;
  const deleted = await db.delete(attachmentsTable).where(and(eq(attachmentsTable.id, id), isNull(attachmentsTable.messageId))).returning({ id: attachmentsTable.id });
  if (!deleted.length) return; // wasn't actually an avatar row — leave the file alone
  await fs.unlink(filePathFor(id)).catch((err: NodeJS.ErrnoException) => { if (err.code !== 'ENOENT') throw err; });
}

export function sanitizeFileName(raw: unknown): string {
  const s = String(raw == null ? '' : raw).trim().replace(/[\r\n/\\]/g, '_').slice(0, 200);
  return s || 'arquivo';
}

/** ASCII fallback (`filename=`) plus a real UTF-8 filename* (RFC 5987),
 * which modern browsers prefer — handles accents/spaces/quotes safely. */
export function contentDispositionFor(kind: 'inline' | 'attachment', fileName: string): string {
  const asciiFallback = fileName.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, "'");
  return `${kind}; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

// serializes concurrent complete() calls for the SAME uploadId — without
// this, a duplicate client retry could try to assemble/write the same final
// file twice. Process-lifetime only (correctly resets on restart).
const completingUploads = new Set<string>();

/** Step 1/3 — declares the file before any bytes are sent, so an invalid
 * channel/quota/size fails fast. Server decides chunkSize; the client never
 * hardcodes it. */
async function handleAttachmentInit(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const cookies = parseCookies(request.headers.cookie || '');
  const sess = await resolveSession(cookies[config.SESSION_COOKIE]);
  if (!sess) return sendError(reply, 401, 'unauthenticated', 'Nao autenticado.');

  const body = jsonBody(request.body);
  const channelId = String(body.channelId || '');
  if (!channelId || !(await channelExists(channelId))) return sendError(reply, 404, 'channel_not_found', 'Canal nao encontrado.');

  const fileName = sanitizeFileName(body.fileName);
  const mimeType = String(body.mimeType || 'application/octet-stream').split(';')[0]!.trim() || 'application/octet-stream';
  const caption = String(body.caption || '').trim().slice(0, config.MAX_CHAT_LEN);

  const totalSize = Number(body.totalSize);
  if (!Number.isInteger(totalSize) || totalSize <= 0 || totalSize > config.MAX_ATTACHMENT_BYTES) {
    return sendError(reply, 400, 'invalid_size', 'Tamanho de arquivo invalido.');
  }

  const usage = await getUsage();
  if (usage.totalBytes + totalSize > config.MAX_STORAGE_BYTES) {
    return sendError(reply, 400, 'storage_full', 'Armazenamento cheio (30GB no total). Apague arquivos antigos antes de enviar mais.');
  }

  const uploadId = newId();
  const chunkSize = config.UPLOAD_CHUNK_BYTES;
  const totalChunks = Math.ceil(totalSize / chunkSize);
  await fs.mkdir(tmpDirFor(uploadId), { recursive: true });
  await fs.writeFile(manifestPathFor(uploadId), JSON.stringify({
    uploadId, userId: sess.userId, channelId, fileName, mimeType, totalSize, caption,
    chunkSize, totalChunks, createdAt: new Date().toISOString(),
  } satisfies UploadManifest));

  sendJson(reply, 201, { uploadId, chunkSize, totalChunks });
}

/** Step 2/3 — one chunk (up to UPLOAD_CHUNK_BYTES, last one may be
 * smaller). Idempotent: re-sending the same index is a safe retry. */
export async function handleAttachmentChunk(request: FastifyRequest<{ Params: { id: string; index: string } }>, reply: FastifyReply): Promise<void> {
  const uploadId = request.params.id;
  const index = Number(request.params.index);
  const cookies = parseCookies(request.headers.cookie || '');
  const sess = await resolveSession(cookies[config.SESSION_COOKIE]);
  if (!sess) return sendError(reply, 401, 'unauthenticated', 'Nao autenticado.');

  const manifest = await readManifest(uploadId);
  if (!manifest || manifest.userId !== sess.userId) return sendError(reply, 404, 'upload_not_found', 'Upload nao encontrado.');
  if (!Number.isInteger(index) || index < 0 || index >= manifest.totalChunks) {
    return sendError(reply, 400, 'invalid_index', 'Indice de pedaco invalido.');
  }

  // raw Buffer body — content-type parser for this route is swapped in
  // registerAttachmentRoutes below; bodyLimit caps it, but the exact length
  // still needs checking here (the last chunk is always smaller).
  const expected = expectedChunkLength(manifest, index);
  const buffer = request.body as Buffer;
  if (buffer.length !== expected) return sendError(reply, 400, 'chunk_size_mismatch', 'Tamanho do pedaco nao bate com o esperado.');

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
  if (!sess) return sendError(reply, 401, 'unauthenticated', 'Nao autenticado.');

  const manifest = await readManifest(uploadId);
  if (!manifest || manifest.userId !== sess.userId) return sendError(reply, 404, 'upload_not_found', 'Upload nao encontrado.');

  if (completingUploads.has(uploadId)) return sendError(reply, 409, 'already_completing', 'Upload ja esta sendo finalizado.');
  completingUploads.add(uploadId);

  try {
    for (let i = 0; i < manifest.totalChunks; i++) {
      try {
        await fs.access(chunkPathFor(uploadId, i));
      } catch {
        return sendError(reply, 400, 'incomplete_upload', 'Faltam pedacos do arquivo.');
      }
    }
    let receivedTotal = 0;
    for (let i = 0; i < manifest.totalChunks; i++) {
      receivedTotal += (await fs.stat(chunkPathFor(uploadId, i))).size;
    }
    if (receivedTotal !== manifest.totalSize) return sendError(reply, 400, 'size_mismatch', 'Tamanho recebido nao bate com o declarado.');

    const usage = await getUsage();
    if (usage.totalBytes + manifest.totalSize > config.MAX_STORAGE_BYTES) {
      return sendError(reply, 400, 'storage_full', 'Armazenamento cheio (30GB no total). Apague arquivos antigos antes de enviar mais.');
    }

    const destPath = filePathFor(uploadId);
    let row: Attachment;
    let message: typeof messages.$inferSelect;
    try {
      await assembleChunks(uploadId, manifest, destPath);
      const inserted = await db.transaction(async (tx) => {
        const [messageRow] = await tx.insert(messages).values({
          channelId: manifest.channelId, authorId: sess.userId, authorName: sess.username, authorAvatar: sess.avatar, text: manifest.caption,
        }).returning();
        const [attachmentRow] = await tx.insert(attachmentsTable).values({
          id: uploadId, messageId: messageRow!.id, fileName: manifest.fileName, mimeType: manifest.mimeType, size: manifest.totalSize,
        }).returning();
        return { messageRow: messageRow!, attachmentRow: attachmentRow! };
      });
      row = inserted.attachmentRow;
      message = inserted.messageRow;
    } catch (err) {
      // keep the CHUNKS on purpose — client can retry complete() without
      // re-uploading everything; only the (partial/invalid) final file is
      // discarded.
      await fs.unlink(destPath).catch(() => {});
      throw err;
    }

    // only deleted after a successful commit; a failed delete here just
    // logs — sweepStaleUploads cleans it up later.
    await fs.rm(tmpDirFor(uploadId), { recursive: true, force: true })
      .catch((err) => console.error('[attachments] falha ao apagar chunks apos montagem:', err instanceof Error ? err.stack : err));

    const chatMessage = {
      msgId: message.id,
      channelId: message.channelId,
      id: message.authorId,
      name: message.authorName,
      avatar: message.authorAvatar,
      text: message.text,
      ts: message.createdAt.getTime(),
      attachment: { id: row.id, name: row.fileName, mime: row.mimeType, size: row.size },
    };
    broadcast({ t: 'chat', message: chatMessage });
    await broadcastUsage();
    sendJson(reply, 201, { message: chatMessage });
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
  if (!sess) return sendError(reply, 401, 'unauthenticated', 'Nao autenticado.');

  const manifest = await readManifest(uploadId);
  if (manifest && manifest.userId === sess.userId) {
    await fs.rm(tmpDirFor(uploadId), { recursive: true, force: true }).catch(() => {});
  }
  sendJson(reply, 200, { ok: true });
}

/** Avatar upload — same storage/serving route as chat attachments
 * (`/uploads/<id>`), but the row is born with `messageId: null` (marks it
 * as an avatar, see schema.ts/getUsage) and skips the 30GB quota. Client
 * sends raw image bytes; applying the result as the account's avatar
 * happens in the existing `profile` websocket flow (realtime/participants.ts),
 * which also cleans up the old file (see deleteAvatarFile above). */
async function handleAvatarUpload(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const cookies = parseCookies(request.headers.cookie || '');
  const sess = await resolveSession(cookies[config.SESSION_COOKIE]);
  if (!sess) return sendError(reply, 401, 'unauthenticated', 'Nao autenticado.');

  const mimeType = String(request.headers['content-type'] || '').split(';')[0]!.trim();
  if (!AVATAR_MIME_TYPES.has(mimeType)) {
    return sendError(reply, 400, 'invalid_type', 'Formato invalido. Use PNG, JPEG, GIF ou WEBP.');
  }

  const buffer = request.body as Buffer;
  if (buffer.length === 0) return sendError(reply, 400, 'empty_file', 'Arquivo vazio.');

  const id = newId();
  await fs.writeFile(filePathFor(id), buffer);
  try {
    await db.insert(attachmentsTable).values({ id, messageId: null, fileName: 'avatar', mimeType, size: buffer.length });
  } catch (err) {
    await fs.unlink(filePathFor(id)).catch(() => {});
    throw err;
  }
  sendJson(reply, 201, { avatar: `/uploads/${id}` });
}

export async function serveUpload(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply): Promise<void> {
  const cookies = parseCookies(request.headers.cookie || '');
  const sess = await resolveSession(cookies[config.SESSION_COOKIE]);
  if (!sess) { reply.code(401).send('nao autenticado'); return; }

  const id = request.params.id;
  if (!ID_RE.test(id)) { reply.code(400).send('id invalido'); return; }

  const [row] = await db.select().from(attachmentsTable).where(eq(attachmentsTable.id, id)).limit(1);
  if (!row) { reply.code(404).send('nao encontrado'); return; }

  let data: Buffer;
  try {
    data = await fs.readFile(filePathFor(id));
  } catch {
    reply.code(404).send('nao encontrado');
    return;
  }

  const inline = INLINE_MIME_TYPES.has(row.mimeType);
  reply
    .code(200)
    .header('Content-Type', inline ? row.mimeType : 'application/octet-stream')
    .header('Content-Disposition', contentDispositionFor(inline ? 'inline' : 'attachment', row.fileName))
    .header('Content-Length', data.length)
    .header('X-Content-Type-Options', 'nosniff')
    // private, not public: gated by session — a shared cache shouldn't
    // serve this to someone else without re-checking.
    .header('Cache-Control', 'private, max-age=31536000, immutable')
    .send(data);
}

export function registerAttachmentRoutes(fastify: FastifyInstance): void {
  fastify.post('/api/attachments/init', handleAttachmentInit);
  fastify.post('/api/attachments/:id/complete', handleAttachmentComplete);
  fastify.delete('/api/attachments/:id', handleAttachmentCancel);
  fastify.get('/uploads/:id', serveUpload);

  // raw Buffer body, not JSON — scoped plugin for just these 2 routes:
  // swapping addContentTypeParser on the root instance would break JSON
  // parsing for every other /api/* route.
  fastify.register(async (scoped) => {
    scoped.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, payload, done) => done(null, payload));
    scoped.post('/api/attachments/:id/chunk/:index', { bodyLimit: config.UPLOAD_CHUNK_BYTES }, handleAttachmentChunk);
    scoped.post('/api/avatar', { bodyLimit: config.MAX_AVATAR_BYTES }, handleAvatarUpload);
  });
}

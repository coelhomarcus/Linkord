import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import fsStreams from 'node:fs'; // only for createReadStream/createWriteStream (chunk assembly), see assembleChunks
import path from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import sharp from 'sharp';
import { eq, and, asc, inArray, isNull, isNotNull, sql } from 'drizzle-orm';
import { config } from '../config/env.js';
import { db } from '../db/client.js';
import { attachments as attachmentsTable, messages, type Attachment } from '../db/schema.js';
import { broadcast } from '../realtime/participants.js';
import { sendJson, sendError, jsonBody } from '../http/respond.js';
import { parseCookies } from '../http/cookies.js';
import { resolveSession } from './auth/session.js';
import { broadcastToConversationMembers, conversationExistsForUser, touchConversation } from './conversations.js';

// Chat attachments: up to MAX_ATTACHMENTS_PER_MESSAGE per message, stored on
// disk keyed by a uuid (no extension — real mime type lives in the
// mime_type column, never trust the name). Quota is computed live from the
// table, not a cached counter, so it can't drift from what's actually on
// disk. Only a known list of image/video/audio mimes is served inline;
// everything else forces a download (prevents an uploaded .svg/.html from
// executing script on our own origin — see serveUpload).
const INLINE_MIME_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp',
  'video/mp4', 'video/webm', 'video/ogg',
  'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/mp4',
]);
const ID_RE = /^[0-9a-f]{32}$/; // crypto.randomUUID() without dashes, see newId
const RANGE_RE = /^bytes=(\d*)-(\d*)$/; // single-range only — the only form <video>/<audio> ever sends
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

const MAX_CROP_DIMENSION = 4096; // sane ceiling, well under sharp's own decompression-bomb guard

/** Parses the `?crop=` query param (JSON `{x,y,width,height}`, same shape as
 * react-easy-crop's `Area`) into the rect handleAvatarUpload extracts. */
function parseCropRect(raw: string | undefined): { left: number; top: number; width: number; height: number } | null {
  if (!raw) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return null; }
  if (!parsed || typeof parsed !== 'object') return null;
  const { x, y, width, height } = parsed as Record<string, unknown>;
  if (typeof x !== 'number' || typeof y !== 'number' || typeof width !== 'number' || typeof height !== 'number'
    || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height)) return null;
  if (width <= 0 || height <= 0 || x < 0 || y < 0 || width > MAX_CROP_DIMENSION || height > MAX_CROP_DIMENSION) return null;
  return { left: Math.round(x), top: Math.round(y), width: Math.round(width), height: Math.round(height) };
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

/** One query for all messages' attachments (avoids N+1). Up to
 * MAX_ATTACHMENTS_PER_MESSAGE rows per message now (see
 * handleAttachmentComplete's targetMsgId path) — ordered by createdAt so
 * multi-attachment order survives (attachments upload sequentially,
 * client-side, so createdAt timestamps never collide in practice). */
export async function getByMessageIds(messageIds: number[]): Promise<Map<number, Attachment[]>> {
  const map = new Map<number, Attachment[]>();
  if (!messageIds.length) return map;
  const rows = await db.select().from(attachmentsTable)
    .where(inArray(attachmentsTable.messageId, messageIds))
    .orderBy(asc(attachmentsTable.createdAt));
  for (const row of rows) {
    if (row.messageId === null) continue;
    const list = map.get(row.messageId);
    if (list) list.push(row); else map.set(row.messageId, [row]);
  }
  return map;
}

/** Deletes the on-disk file(s) only — the DB row(s) disappear via CASCADE
 * when the message is deleted right after (see modules/chat.ts). Postgres
 * doesn't know about the file, so that part has to happen separately. */
export async function deleteForMessage(messageId: number): Promise<void> {
  const rows = await db.select().from(attachmentsTable).where(eq(attachmentsTable.messageId, messageId));
  await Promise.all(rows.map((row) => fs.unlink(filePathFor(row.id)).catch((err: NodeJS.ErrnoException) => { if (err.code !== 'ENOENT') throw err; })));
}

/** Same idea in bulk — deleting a conversation CASCADEs messages/attachments
 * in Postgres without going through deleteForMessage, so this exists purely
 * to avoid orphaned files. Called by modules/conversations.ts before the
 * delete. */
export async function deleteForConversation(conversationId: string): Promise<void> {
  const rows = await db
    .select({ id: attachmentsTable.id })
    .from(attachmentsTable)
    .innerJoin(messages, eq(attachmentsTable.messageId, messages.id))
    .where(eq(messages.conversationId, conversationId));
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

function getReservedBytes(): number {
  let sum = 0;
  for (const bytes of pendingUploadBytes.values()) sum += bytes;
  return sum;
}

// Serializes the check-then-reserve section of init() across concurrent
// requests (single-instance deployment, same assumption as completingUploads
// above) — without this, two init()s could both read the same
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
async function handleAttachmentInit(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const cookies = parseCookies(request.headers.cookie || '');
  const sess = await resolveSession(cookies[config.SESSION_COOKIE]);
  if (!sess) return sendError(reply, 401, 'unauthenticated', 'Nao autenticado.');

  const body = jsonBody(request.body);
  const conversationId = String(body.conversationId || '');
  if (!conversationId || !(await conversationExistsForUser(conversationId, sess.userId))) {
    return sendError(reply, 404, 'conversation_not_found', 'Conversa nao encontrada.');
  }

  const fileName = sanitizeFileName(body.fileName);
  const mimeType = String(body.mimeType || 'application/octet-stream').split(';')[0]!.trim() || 'application/octet-stream';
  const caption = String(body.caption || '').trim().slice(0, config.MAX_CHAT_LEN);

  const totalSize = Number(body.totalSize);
  if (!Number.isInteger(totalSize) || totalSize <= 0 || totalSize > config.MAX_ATTACHMENT_BYTES) {
    return sendError(reply, 400, 'invalid_size', 'Tamanho de arquivo invalido.');
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

  // optional — present only when this file is the 2nd-4th attachment of a
  // message whose FIRST attachment already created it (see
  // chunkedUpload.ts/RoomProvider.tsx#sendAttachments). The client now
  // always sends a JSON body here (possibly `{}`), even for the common
  // single-attachment case.
  const body = jsonBody(request.body);
  let targetMsgId: number | null = null;
  if (body.targetMsgId != null) {
    targetMsgId = Number(body.targetMsgId);
    if (!Number.isFinite(targetMsgId)) return sendError(reply, 400, 'invalid_target', 'targetMsgId invalido.');
    const [existing] = await db.select().from(messages).where(eq(messages.id, targetMsgId)).limit(1);
    if (!existing) return sendError(reply, 404, 'target_message_not_found', 'Mensagem de destino nao encontrada.');
    if (existing.authorId !== sess.userId) return sendError(reply, 403, 'not_your_message', 'Voce so pode anexar arquivos as suas proprias mensagens.');
    if (existing.conversationId !== manifest.conversationId) return sendError(reply, 400, 'conversation_mismatch', 'Conversa nao bate com o upload.');
    if (Date.now() - existing.createdAt.getTime() > config.ATTACH_TO_MESSAGE_WINDOW_MS) {
      return sendError(reply, 400, 'target_message_too_old', 'Mensagem de destino e antiga demais pra receber mais anexos.');
    }
  }

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
        return sendError(reply, 400, 'too_many_attachments', 'Essa mensagem ja tem o maximo de anexos.');
      }
      throw err;
    }

    // only deleted after a successful commit; a failed delete here just
    // logs — sweepStaleUploads cleans it up later.
    await fs.rm(tmpDirFor(uploadId), { recursive: true, force: true })
      .catch((err) => console.error('[attachments] falha ao apagar chunks apos montagem:', err instanceof Error ? err.stack : err));
    pendingUploadBytes.delete(uploadId);

    const attachmentPayload = { id: row.id, name: row.fileName, mime: row.mimeType, size: row.size };
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
      await touchConversation(manifest.conversationId);
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
  if (!sess) return sendError(reply, 401, 'unauthenticated', 'Nao autenticado.');

  const manifest = await readManifest(uploadId);
  if (manifest && manifest.userId === sess.userId) {
    await fs.rm(tmpDirFor(uploadId), { recursive: true, force: true }).catch(() => {});
    pendingUploadBytes.delete(uploadId);
  }
  sendJson(reply, 200, { ok: true });
}

/** Avatar upload — same storage/serving route as chat attachments
 * (`/uploads/<id>`), but the row is born with `messageId: null` (marks it
 * as an avatar, see schema.ts/getUsage) and skips the 30GB quota. Client
 * sends the ORIGINAL (uncropped) image bytes plus a `?crop=` rect (the
 * react-easy-crop pixel area) — the crop itself happens here via sharp, not
 * client-side canvas, so an animated GIF/WebP survives as an animated
 * GIF/WebP instead of being flattened to one frame (`{ animated: true }`
 * makes sharp treat every frame as one page of a stacked canvas; `.extract()`
 * with a rect against ONE frame's bounds applies that same rect to every
 * page). Static images keep today's behavior (re-encoded to JPEG). Applying
 * the result as the
 * account's avatar happens in the existing `profile` websocket flow
 * (realtime/participants.ts), which also cleans up the old file (see
 * deleteAvatarFile above). */
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

  const cropRect = parseCropRect((request.query as Record<string, string | undefined>).crop);
  if (!cropRect) return sendError(reply, 400, 'invalid_crop', 'Recorte invalido.');

  let outBuffer: Buffer;
  let outMime: string;
  try {
    const image = sharp(buffer, { animated: true });
    const meta = await image.metadata();
    const frameHeight = meta.pageHeight ?? meta.height ?? 0;
    if (!meta.width || !frameHeight
      || cropRect.left + cropRect.width > meta.width
      || cropRect.top + cropRect.height > frameHeight) {
      return sendError(reply, 400, 'invalid_crop', 'Recorte fora dos limites da imagem.');
    }
    const extracted = image.extract(cropRect);
    if ((meta.pages ?? 1) > 1) {
      outBuffer = await extracted.gif().toBuffer();
      outMime = 'image/gif';
    } else {
      outBuffer = await extracted.jpeg({ quality: 92 }).toBuffer();
      outMime = 'image/jpeg';
    }
  } catch (err) {
    console.warn(`[attachments] falha ao recortar avatar: ${err instanceof Error ? err.message : err}`);
    return sendError(reply, 400, 'crop_failed', 'Nao foi possivel processar a imagem.');
  }

  const id = newId();
  await fs.writeFile(filePathFor(id), outBuffer);
  try {
    await db.insert(attachmentsTable).values({ id, messageId: null, fileName: 'avatar', mimeType: outMime, size: outBuffer.length });
  } catch (err) {
    await fs.unlink(filePathFor(id)).catch(() => {});
    throw err;
  }
  sendJson(reply, 201, { avatar: `/uploads/${id}` });
}

export async function serveUpload(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply): Promise<FastifyReply> {
  const cookies = parseCookies(request.headers.cookie || '');
  const sess = await resolveSession(cookies[config.SESSION_COOKIE]);
  if (!sess) return reply.code(401).send('nao autenticado');

  const id = request.params.id;
  if (!ID_RE.test(id)) return reply.code(400).send('id invalido');

  const [row] = await db.select().from(attachmentsTable).where(eq(attachmentsTable.id, id)).limit(1);
  if (!row) return reply.code(404).send('nao encontrado');

  const path = filePathFor(id);
  let size: number;
  try {
    size = (await fs.stat(path)).size;
  } catch {
    return reply.code(404).send('nao encontrado');
  }

  const inline = INLINE_MIME_TYPES.has(row.mimeType);
  const contentType = inline ? row.mimeType : 'application/octet-stream';
  const disposition = contentDispositionFor(inline ? 'inline' : 'attachment', row.fileName);
  // private, not public: gated by session — a shared cache shouldn't serve
  // this to someone else without re-checking.
  const cacheControl = 'private, max-age=31536000, immutable';

  // Range requests are what let <video>/<audio> seek at all — without
  // Accept-Ranges + 206 responses, the browser can't jump to an arbitrary
  // byte offset and a seek attempt just snaps back to wherever playback
  // already reached (it can only play what it's already downloaded
  // sequentially from the start).
  const range = RANGE_RE.exec(request.headers.range || '');
  if (range) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Number(range[2]) : size - 1;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start > end || end >= size) {
      return reply.code(416).header('Content-Range', `bytes */${size}`).send();
    }
    // `return` (not a bare `.send()` call) matters here: without it, this
    // async function's own promise resolves before Fastify's onSend
    // pipeline finishes piping the stream (nothing here is awaited after
    // send()), and Fastify's core — seeing the handler "return" with
    // reply.sent still false at that point — races in an empty auto-reply
    // that ends the response at 0 bytes before the real stream gets a
    // chance to write anything (see the "did you forget to 'return reply'"
    // warning in fastify/lib/reply.js).
    return reply
      .code(206)
      .header('Content-Type', contentType)
      .header('Content-Disposition', disposition)
      .header('Content-Range', `bytes ${start}-${end}/${size}`)
      .header('Content-Length', end - start + 1)
      .header('Accept-Ranges', 'bytes')
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cache-Control', cacheControl)
      .send(fsStreams.createReadStream(path, { start, end }));
  }

  return reply
    .code(200)
    .header('Content-Type', contentType)
    .header('Content-Disposition', disposition)
    .header('Content-Length', size)
    .header('Accept-Ranges', 'bytes')
    .header('X-Content-Type-Options', 'nosniff')
    .header('Cache-Control', cacheControl)
    .send(fsStreams.createReadStream(path));
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

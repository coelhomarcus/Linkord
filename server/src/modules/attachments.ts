import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import fsStreams from 'node:fs'; // only for createReadStream/createWriteStream (chunk assembly), see assembleChunks
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { eq, and, inArray, isNull, isNotNull, lt, sql } from 'drizzle-orm';
import { config } from '../config/env.js';
import { db } from '../db/client.js';
import { attachments as attachmentsTable, messages, users, type Attachment } from '../db/schema.js';
import { broadcast } from '../realtime/participants.js';
import { sendJson, sendError, jsonBody } from '../http/respond.js';
import { parseCookies } from '../http/cookies.js';
import { resolveSession } from './auth/session.js';
import { textChannelExists } from './channels.js';

// Chat attachments: max one per message, stored on disk keyed by a uuid (no
// extension — real mime type lives in the mime_type column, never trust the
// name). Committed quota is computed live from the table and active manifests
// reserve their full declared size. Only a known list of image/video/audio
// mimes is served inline; everything else forces a download
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

// Admission limits are deliberately process-local, matching the current
// single-instance deployment. Persisted manifests below remain the source of
// truth for active sessions after a restart.
const MAX_ACTIVE_UPLOADS_PER_USER = 3;
const MAX_CONCURRENT_CHUNK_WRITES_PER_USER = 4; // browser currently uses 3
const MAX_CONCURRENT_CHUNK_WRITES_GLOBAL = 24;
const MAX_CONCURRENT_COMPLETIONS_PER_USER = 1;
const MAX_CONCURRENT_COMPLETIONS_GLOBAL = 2;
const ATTACHMENT_INIT_RATE_LIMIT = 20;
const ATTACHMENT_INIT_RATE_WINDOW_MS = 10 * 60 * 1000;
const AVATAR_UPLOAD_RATE_LIMIT = 10;
const AVATAR_UPLOAD_RATE_WINDOW_MS = 60 * 60 * 1000;
const MAX_PENDING_AVATARS_PER_USER = 3;
const AVATAR_OWNER_PREFIX = 'avatar-owner:';

interface RateLimitEntry {
  count: number;
  windowStartMs: number;
}

/** Small fixed-window limiter used for expensive upload admission. Returns
 * null when accepted, otherwise Retry-After in seconds. */
export class FixedWindowRateLimiter {
  private readonly entries = new Map<string, RateLimitEntry>();
  private readonly limit: number;
  private readonly windowMs: number;

  constructor(limit: number, windowMs: number) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  consume(key: string, now = Date.now()): number | null {
    const current = this.entries.get(key);
    if (!current || now - current.windowStartMs >= this.windowMs) {
      this.entries.set(key, { count: 1, windowStartMs: now });
      return null;
    }
    if (current.count >= this.limit) {
      return Math.max(1, Math.ceil((current.windowStartMs + this.windowMs - now) / 1000));
    }
    current.count += 1;
    return null;
  }

  sweep(now = Date.now()): void {
    for (const [key, entry] of this.entries) {
      if (now - entry.windowStartMs >= this.windowMs) this.entries.delete(key);
    }
  }
}

class AsyncLock {
  private tail: Promise<void> = Promise.resolve();

  async run<T>(work: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await work();
    } finally {
      release();
    }
  }
}

const attachmentInitLimiter = new FixedWindowRateLimiter(ATTACHMENT_INIT_RATE_LIMIT, ATTACHMENT_INIT_RATE_WINDOW_MS);
const avatarUploadLimiter = new FixedWindowRateLimiter(AVATAR_UPLOAD_RATE_LIMIT, AVATAR_UPLOAD_RATE_WINDOW_MS);
const uploadAdmissionLock = new AsyncLock();
const avatarMutationLock = new AsyncLock();

export interface ByteRange {
  start: number;
  end: number;
}

/** Parses one RFC 7233 bytes range. Multiple/malformed/unsatisfiable ranges
 * return null; callers answer 416. End values beyond EOF are clamped. */
export function parseByteRange(value: string, size: number): ByteRange | null {
  if (!Number.isSafeInteger(size) || size <= 0) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || (!match[1] && !match[2])) return null;

  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
    return { start: Math.max(0, size - suffixLength), end: size - 1 };
  }

  const start = Number(match[1]);
  if (!Number.isSafeInteger(start) || start < 0 || start >= size) return null;
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(requestedEnd) || requestedEnd < start) return null;
  return { start, end: Math.min(requestedEnd, size - 1) };
}

export function uploadEtag(size: number, mtimeMs: number): string {
  return `"${size.toString(16)}-${Math.trunc(mtimeMs).toString(16)}"`;
}

/** If-Range only accepts a matching strong ETag or a date not older than the
 * current representation. Invalid/weak validators deliberately force 200. */
export function ifRangeMatches(value: string | undefined, etag: string, mtimeMs: number): boolean {
  if (!value) return true;
  const candidate = value.trim();
  if (candidate.startsWith('W/')) return false;
  if (candidate.startsWith('"')) return candidate === etag;
  const timestamp = Date.parse(candidate);
  // HTTP dates have one-second precision; tolerate the discarded millis.
  return Number.isFinite(timestamp) && mtimeMs < timestamp + 1000;
}

export function avatarStorageName(userId: string): string {
  return `${AVATAR_OWNER_PREFIX}${userId}`;
}

export function avatarStorageBelongsTo(fileName: string, userId: string): boolean {
  return fileName === avatarStorageName(userId);
}

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
  if (!ID_RE.test(uploadId)) return null;
  try {
    const value: unknown = JSON.parse(await fs.readFile(manifestPathFor(uploadId), 'utf8'));
    if (!value || typeof value !== 'object') return null;
    const manifest = value as Partial<UploadManifest>;
    if (
      manifest.uploadId !== uploadId
      || typeof manifest.userId !== 'string' || !manifest.userId
      || typeof manifest.channelId !== 'string' || !manifest.channelId
      || typeof manifest.fileName !== 'string'
      || typeof manifest.mimeType !== 'string'
      || typeof manifest.caption !== 'string'
      || typeof manifest.createdAt !== 'string' || !Number.isFinite(Date.parse(manifest.createdAt))
      || !Number.isSafeInteger(manifest.totalSize) || manifest.totalSize! <= 0 || manifest.totalSize! > config.MAX_ATTACHMENT_BYTES
      || !Number.isSafeInteger(manifest.chunkSize) || manifest.chunkSize! <= 0 || manifest.chunkSize! > config.UPLOAD_CHUNK_BYTES
      || !Number.isSafeInteger(manifest.totalChunks) || manifest.totalChunks! <= 0
      || manifest.totalChunks !== Math.ceil(manifest.totalSize! / manifest.chunkSize!)
    ) return null;
    return manifest as UploadManifest;
  } catch {
    return null;
  }
}

async function listUploadManifests(): Promise<Array<{ uploadId: string; manifest: UploadManifest }>> {
  const tmpRoot = path.join(config.UPLOAD_DIR, 'tmp');
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(tmpRoot, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const found: Array<{ uploadId: string; manifest: UploadManifest }> = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !ID_RE.test(entry.name)) continue;
    const manifest = await readManifest(entry.name);
    if (manifest) found.push({ uploadId: entry.name, manifest });
  }
  return found;
}

interface PendingReservationInfo {
  totalBytes: number;
  countByUser: Map<string, number>;
}

/** Declared bytes are reservations, not only chunks already received. This
 * prevents parallel init/complete requests from all observing the same free
 * quota. Manifests whose attachment already committed are ignored. */
async function getPendingReservationInfo(): Promise<PendingReservationInfo> {
  const entries = await listUploadManifests();
  const committedIds = new Set<string>();
  if (entries.length) {
    const rows = await db
      .select({ id: attachmentsTable.id })
      .from(attachmentsTable)
      .where(inArray(attachmentsTable.id, entries.map((entry) => entry.uploadId)));
    for (const row of rows) committedIds.add(row.id);
  }

  let totalBytes = 0;
  const countByUser = new Map<string, number>();
  for (const { uploadId, manifest } of entries) {
    if (committedIds.has(uploadId)) continue;
    totalBytes += manifest.totalSize;
    countByUser.set(manifest.userId, (countByUser.get(manifest.userId) || 0) + 1);
  }
  return { totalBytes, countByUser };
}

/** All chunks are chunkSize except the last, which is the remainder. */
export function expectedChunkLength(manifest: UploadManifest, index: number): number {
  return index === manifest.totalChunks - 1
    ? manifest.totalSize - manifest.chunkSize * (manifest.totalChunks - 1)
    : manifest.chunkSize;
}

/** Streams chunks in order into the final file — never Buffer.concat, which
 * is exactly what a 2GB upload needs to avoid. A single pipeline owns the
 * destination stream, so hundreds of chunks do not accumulate error
 * listeners on it. */
async function assembleChunks(uploadId: string, manifest: UploadManifest, destPath: string): Promise<void> {
  let outputHandle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    // Exclusive creation prevents a stale/retried session from overwriting a
    // committed attachment that already owns this id.
    outputHandle = await fs.open(destPath, 'wx');
    async function* contents(): AsyncGenerator<Buffer> {
      for (let i = 0; i < manifest.totalChunks; i++) {
        const readStream = fsStreams.createReadStream(chunkPathFor(uploadId, i));
        for await (const chunk of readStream) yield chunk as Buffer;
      }
    }
    await pipeline(contents(), outputHandle.createWriteStream());
  } catch (err) {
    // Only unlink when this invocation successfully created the destination;
    // an EEXIST error must never delete somebody else's committed file.
    if (outputHandle) {
      await outputHandle.close().catch(() => {});
      await fs.unlink(destPath).catch(() => {});
    }
    throw err;
  }
}

async function removeUploadSessionDir(uploadId: string): Promise<void> {
  // Never recurse through an arbitrary path read from disk/a URL.
  if (!ID_RE.test(uploadId)) return;
  await fs.rm(tmpDirFor(uploadId), { recursive: true, force: true });
}

async function sweepStaleUploadSessions(cutoffMs: number): Promise<void> {
  const tmpRoot = path.join(config.UPLOAD_DIR, 'tmp');
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(tmpRoot, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw err;
  }
  for (const entry of entries) {
    const id = entry.name;
    if (!entry.isDirectory() || !ID_RE.test(id)) continue;
    if (completingUploads.has(id) || (activeChunkWritesByUpload.get(id) || 0) > 0) continue;
    const dir = path.join(tmpRoot, id);
    let createdAtMs: number;
    const manifest = await readManifest(id);
    if (manifest) {
      const [committed] = await db.select({ id: attachmentsTable.id }).from(attachmentsTable).where(eq(attachmentsTable.id, id)).limit(1);
      if (committed) {
        await removeUploadSessionDir(id).catch(() => {});
        continue;
      }
      createdAtMs = Date.parse(manifest.createdAt);
    } else {
      // manifest missing/corrupt — fall back to the folder's creation time
      // so it can still be swept.
      try {
        const stat = await fs.lstat(dir);
        if (!stat.isDirectory() || stat.isSymbolicLink()) continue;
        createdAtMs = stat.birthtimeMs || stat.mtimeMs;
      } catch {
        continue;
      }
    }
    if (createdAtMs < cutoffMs) {
      await removeUploadSessionDir(id).catch(() => {});
    }
  }
}

async function sweepOrphanAvatars(cutoff: Date): Promise<void> {
  await avatarMutationLock.run(async () => {
    const [staleRows, currentUsers] = await Promise.all([
      db.select().from(attachmentsTable).where(and(isNull(attachmentsTable.messageId), lt(attachmentsTable.createdAt, cutoff))),
      db.select({ avatar: users.avatar }).from(users),
    ]);
    const referencedIds = new Set<string>();
    for (const user of currentUsers) {
      const match = AVATAR_URL_RE.exec(user.avatar);
      if (match) referencedIds.add(match[1]!);
    }
    for (const row of staleRows) {
      if (referencedIds.has(row.id)) continue;
      const deleted = await db
        .delete(attachmentsTable)
        .where(and(eq(attachmentsTable.id, row.id), isNull(attachmentsTable.messageId)))
        .returning({ id: attachmentsTable.id });
      if (!deleted.length) continue;
      await fs.unlink(filePathFor(row.id)).catch((err: NodeJS.ErrnoException) => { if (err.code !== 'ENOENT') throw err; });
    }
  });
}

async function sweepOrphanFinalFiles(cutoffMs: number): Promise<void> {
  const rows = await db.select({ id: attachmentsTable.id }).from(attachmentsTable);
  const knownIds = new Set(rows.map((row) => row.id));
  const entries = await fs.readdir(config.UPLOAD_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !ID_RE.test(entry.name) || knownIds.has(entry.name)) continue;
    const filePath = filePathFor(entry.name);
    let stat;
    try { stat = await fs.stat(filePath); } catch { continue; }
    // Gives an interrupted complete/avatar transaction plenty of time to
    // finish before treating its just-written file as orphaned.
    if (stat.mtimeMs < cutoffMs) {
      await fs.unlink(filePath).catch((err: NodeJS.ErrnoException) => { if (err.code !== 'ENOENT') throw err; });
    }
  }
}

/** Cleans abandoned chunks, avatar rows never adopted by a profile, and
 * final files left behind by a process crash. Called at boot and hourly. */
export async function sweepStaleUploads(): Promise<void> {
  const cutoffMs = Date.now() - config.UPLOAD_SESSION_TTL_MS;
  await sweepStaleUploadSessions(cutoffMs);
  await sweepOrphanAvatars(new Date(cutoffMs));
  await sweepOrphanFinalFiles(cutoffMs);
  attachmentInitLimiter.sweep();
  avatarUploadLimiter.sweep();
}

export interface UsageInfo {
  totalBytes: number;
  totalFiles: number;
  maxBytes: number;
}

/** Always computed live from committed rows (sum/count the table). Active
 * upload reservations are added separately during admission. Only counts
 * chat attachments (messageId set); avatars are excluded from the 30GB quota
 * on purpose. */
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

/** Applies an avatar while enforcing ownership of newly-uploaded files. Old
 * rows named just "avatar" remain valid only for the profile already using
 * them, preserving upgrades from before ownership markers existed. */
export async function applyAvatarForUser(userId: string, avatar: string): Promise<{ applied: boolean; oldAvatar: string }> {
  return avatarMutationLock.run(async () => db.transaction(async (tx) => {
    const [current] = await tx.select({ avatar: users.avatar }).from(users).where(eq(users.id, userId)).limit(1);
    if (!current) return { applied: false, oldAvatar: '' };

    const uploaded = AVATAR_URL_RE.exec(avatar);
    if (avatar && !uploaded && !/^https?:\/\/\S+$/i.test(avatar)) {
      return { applied: false, oldAvatar: current.avatar };
    }
    if (uploaded) {
      const [row] = await tx.select().from(attachmentsTable).where(eq(attachmentsTable.id, uploaded[1]!)).limit(1);
      const owned = !!row && row.messageId === null && (
        avatarStorageBelongsTo(row.fileName, userId)
        // Legacy compatibility: an old unowned row can only be retained by
        // the account whose DB profile already points to it, never adopted.
        || (row.fileName === 'avatar' && current.avatar === avatar)
      );
      if (!owned) return { applied: false, oldAvatar: current.avatar };
    }

    await tx.update(users).set({ avatar, updatedAt: new Date() }).where(eq(users.id, userId));
    return { applied: true, oldAvatar: current.avatar };
  }));
}

/** Deletes an old avatar file+row after a profile switch. Ownership is
 * checked again; `messageId IS NULL` prevents ever deleting chat media. */
export async function deleteAvatarFile(avatarValue: unknown, ownerUserId?: string): Promise<void> {
  const avatar = String(avatarValue == null ? '' : avatarValue);
  const match = AVATAR_URL_RE.exec(avatar);
  if (!match) return;
  await avatarMutationLock.run(async () => {
    const id = match[1]!;
    const [[row], [referencingUser]] = await Promise.all([
      db.select().from(attachmentsTable).where(and(eq(attachmentsTable.id, id), isNull(attachmentsTable.messageId))).limit(1),
      db.select({ id: users.id }).from(users).where(eq(users.avatar, avatar)).limit(1),
    ]);
    if (!row || referencingUser) return;
    if (ownerUserId && row.fileName !== 'avatar' && !avatarStorageBelongsTo(row.fileName, ownerUserId)) return;
    const deleted = await db.delete(attachmentsTable).where(and(eq(attachmentsTable.id, id), isNull(attachmentsTable.messageId))).returning({ id: attachmentsTable.id });
    if (!deleted.length) return; // wasn't actually an avatar row — leave the file alone
    await fs.unlink(filePathFor(id)).catch((err: NodeJS.ErrnoException) => { if (err.code !== 'ENOENT') throw err; });
  });
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
const completingUploadsByUser = new Map<string, number>();
const activeChunkWritesByUpload = new Map<string, number>();
const activeChunkWritesByUser = new Map<string, number>();
let activeChunkWritesGlobal = 0;

function incrementCounter(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) || 0) + 1);
}

function decrementCounter(map: Map<string, number>, key: string): void {
  const next = (map.get(key) || 1) - 1;
  if (next <= 0) map.delete(key); else map.set(key, next);
}

function sendUploadBusy(reply: FastifyReply, message: string): void {
  reply.header('Retry-After', '5');
  sendError(reply, 429, 'upload_busy', message);
}

/** Step 1/3 — declares the file before any bytes are sent, so an invalid
 * channel/quota/size fails fast. Server decides chunkSize; the client never
 * hardcodes it. */
async function handleAttachmentInit(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const cookies = parseCookies(request.headers.cookie || '');
  const sess = await resolveSession(cookies[config.SESSION_COOKIE]);
  if (!sess) return sendError(reply, 401, 'unauthenticated', 'Nao autenticado.');

  const retryAfter = attachmentInitLimiter.consume(sess.userId);
  if (retryAfter) {
    reply.header('Retry-After', String(retryAfter));
    return sendError(reply, 429, 'upload_rate_limited', 'Muitos uploads iniciados. Tente novamente mais tarde.');
  }

  const body = jsonBody(request.body);
  const channelId = String(body.channelId || '');
  if (!channelId || !(await textChannelExists(channelId))) return sendError(reply, 404, 'channel_not_found', 'Canal de texto nao encontrado.');

  const fileName = sanitizeFileName(body.fileName);
  const mimeType = String(body.mimeType || 'application/octet-stream').split(';')[0]!.trim() || 'application/octet-stream';
  const caption = String(body.caption || '').trim().slice(0, config.MAX_CHAT_LEN);

  const totalSize = Number(body.totalSize);
  if (!Number.isInteger(totalSize) || totalSize <= 0 || totalSize > config.MAX_ATTACHMENT_BYTES) {
    return sendError(reply, 400, 'invalid_size', 'Tamanho de arquivo invalido.');
  }

  const admission = await uploadAdmissionLock.run(async () => {
    const pending = await getPendingReservationInfo();
    if ((pending.countByUser.get(sess.userId) || 0) >= MAX_ACTIVE_UPLOADS_PER_USER) {
      return { error: 'too_many_active_uploads' as const };
    }
    const usage = await getUsage();
    if (usage.totalBytes + pending.totalBytes + totalSize > config.MAX_STORAGE_BYTES) {
      return { error: 'storage_full' as const };
    }

    const uploadId = newId();
    const chunkSize = config.UPLOAD_CHUNK_BYTES;
    const totalChunks = Math.ceil(totalSize / chunkSize);
    await fs.mkdir(tmpDirFor(uploadId), { recursive: true });
    try {
      await fs.writeFile(manifestPathFor(uploadId), JSON.stringify({
        uploadId, userId: sess.userId, channelId, fileName, mimeType, totalSize, caption,
        chunkSize, totalChunks, createdAt: new Date().toISOString(),
      } satisfies UploadManifest), { flag: 'wx' });
    } catch (err) {
      await removeUploadSessionDir(uploadId).catch(() => {});
      throw err;
    }
    return { uploadId, chunkSize, totalChunks };
  });

  if ('error' in admission) {
    if (admission.error === 'too_many_active_uploads') {
      return sendUploadBusy(reply, `Voce ja tem ${MAX_ACTIVE_UPLOADS_PER_USER} uploads em andamento. Termine ou cancele um deles.`);
    }
    return sendError(reply, 400, 'storage_full', 'Armazenamento cheio ou reservado por uploads em andamento. Apague arquivos antigos ou tente mais tarde.');
  }
  sendJson(reply, 201, admission);
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
  if (completingUploads.has(uploadId)) return sendError(reply, 409, 'already_completing', 'Upload ja esta sendo finalizado.');

  // raw Buffer body — content-type parser for this route is swapped in
  // registerAttachmentRoutes below; bodyLimit caps it, but the exact length
  // still needs checking here (the last chunk is always smaller).
  const expected = expectedChunkLength(manifest, index);
  const buffer = request.body as Buffer;
  if (buffer.length !== expected) return sendError(reply, 400, 'chunk_size_mismatch', 'Tamanho do pedaco nao bate com o esperado.');

  if (
    activeChunkWritesGlobal >= MAX_CONCURRENT_CHUNK_WRITES_GLOBAL
    || (activeChunkWritesByUser.get(sess.userId) || 0) >= MAX_CONCURRENT_CHUNK_WRITES_PER_USER
  ) return sendUploadBusy(reply, 'Muitos pedacos sendo gravados ao mesmo tempo. Tente novamente em instantes.');

  activeChunkWritesGlobal += 1;
  incrementCounter(activeChunkWritesByUser, sess.userId);
  incrementCounter(activeChunkWritesByUpload, uploadId);
  try {
    // Re-sending an index intentionally overwrites it: chunk retries remain
    // idempotent, while complete/cancel are excluded by the counters above.
    await fs.writeFile(chunkPathFor(uploadId, index), buffer);
    sendJson(reply, 200, { received: index });
  } finally {
    activeChunkWritesGlobal -= 1;
    decrementCounter(activeChunkWritesByUser, sess.userId);
    decrementCounter(activeChunkWritesByUpload, uploadId);
  }
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
  if ((activeChunkWritesByUpload.get(uploadId) || 0) > 0) return sendUploadBusy(reply, 'Ainda ha pedacos desse upload sendo gravados. Tente novamente em instantes.');
  if (
    completingUploads.size >= MAX_CONCURRENT_COMPLETIONS_GLOBAL
    || (completingUploadsByUser.get(sess.userId) || 0) >= MAX_CONCURRENT_COMPLETIONS_PER_USER
  ) return sendUploadBusy(reply, 'Muitos arquivos sendo finalizados ao mesmo tempo. Tente novamente em instantes.');

  completingUploads.add(uploadId);
  incrementCounter(completingUploadsByUser, sess.userId);

  try {
    // A channel may have been deleted between init and complete. Revalidate
    // before doing expensive disk work and before relying on the FK failure.
    if (!(await textChannelExists(manifest.channelId))) {
      return sendError(reply, 404, 'channel_not_found', 'Canal de texto nao encontrado.');
    }
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

    const hasQuota = await uploadAdmissionLock.run(async () => {
      const [usage, pending] = await Promise.all([getUsage(), getPendingReservationInfo()]);
      return usage.totalBytes + pending.totalBytes <= config.MAX_STORAGE_BYTES;
    });
    if (!hasQuota) {
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
    decrementCounter(completingUploadsByUser, sess.userId);
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
    if (completingUploads.has(uploadId) || (activeChunkWritesByUpload.get(uploadId) || 0) > 0) {
      return sendError(reply, 409, 'upload_busy', 'Upload esta sendo processado; tente cancelar novamente em instantes.');
    }
    await uploadAdmissionLock.run(() => removeUploadSessionDir(uploadId).catch(() => {}));
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

  const retryAfter = avatarUploadLimiter.consume(sess.userId);
  if (retryAfter) {
    reply.header('Retry-After', String(retryAfter));
    return sendError(reply, 429, 'avatar_rate_limited', 'Muitas fotos enviadas. Tente novamente mais tarde.');
  }

  const mimeType = String(request.headers['content-type'] || '').split(';')[0]!.trim();
  if (!AVATAR_MIME_TYPES.has(mimeType)) {
    return sendError(reply, 400, 'invalid_type', 'Formato invalido. Use PNG, JPEG, GIF ou WEBP.');
  }

  const buffer = request.body as Buffer;
  if (buffer.length === 0) return sendError(reply, 400, 'empty_file', 'Arquivo vazio.');

  const result = await avatarMutationLock.run(async () => {
    const ownerName = avatarStorageName(sess.userId);
    const [pendingRows, currentRows] = await Promise.all([
      db.select({ id: attachmentsTable.id }).from(attachmentsTable).where(and(isNull(attachmentsTable.messageId), eq(attachmentsTable.fileName, ownerName))),
      db.select({ avatar: users.avatar }).from(users).where(eq(users.id, sess.userId)).limit(1),
    ]);
    const current = currentRows[0];
    const currentId = current?.avatar ? AVATAR_URL_RE.exec(current.avatar)?.[1] : undefined;
    const pendingCount = pendingRows.filter((row) => row.id !== currentId).length;
    if (pendingCount >= MAX_PENDING_AVATARS_PER_USER) return { error: 'too_many_pending_avatars' as const };

    const id = newId();
    await fs.writeFile(filePathFor(id), buffer, { flag: 'wx' });
    try {
      await db.insert(attachmentsTable).values({ id, messageId: null, fileName: ownerName, mimeType, size: buffer.length });
    } catch (err) {
      await fs.unlink(filePathFor(id)).catch(() => {});
      throw err;
    }
    return { avatar: `/uploads/${id}` };
  });
  if ('error' in result) {
    return sendUploadBusy(reply, `Voce ja tem ${MAX_PENDING_AVATARS_PER_USER} fotos ainda nao aplicadas ao perfil.`);
  }
  sendJson(reply, 201, result);
}

export async function serveUpload(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply): Promise<void> {
  const cookies = parseCookies(request.headers.cookie || '');
  const sess = await resolveSession(cookies[config.SESSION_COOKIE]);
  if (!sess) { reply.code(401).send('nao autenticado'); return; }

  const id = request.params.id;
  if (!ID_RE.test(id)) { reply.code(400).send('id invalido'); return; }

  const [row] = await db.select().from(attachmentsTable).where(eq(attachmentsTable.id, id)).limit(1);
  if (!row) { reply.code(404).send('nao encontrado'); return; }

  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stat = await fs.stat(filePathFor(id));
  } catch {
    reply.code(404).send('nao encontrado');
    return;
  }
  if (!stat.isFile()) { reply.code(404).send('nao encontrado'); return; }

  const inline = INLINE_MIME_TYPES.has(row.mimeType);
  const etag = uploadEtag(stat.size, stat.mtimeMs);
  const displayName = row.messageId === null ? 'avatar' : row.fileName;
  reply
    .header('Content-Type', inline ? row.mimeType : 'application/octet-stream')
    .header('Content-Disposition', contentDispositionFor(inline ? 'inline' : 'attachment', displayName))
    .header('X-Content-Type-Options', 'nosniff')
    .header('Accept-Ranges', 'bytes')
    .header('ETag', etag)
    .header('Last-Modified', stat.mtime.toUTCString())
    // Every reuse must revalidate the authenticated route. ETag keeps that
    // cheap while preventing a browser cache from serving it after logout or
    // an account switch.
    .header('Cache-Control', 'private, no-cache');

  const rangeHeader = typeof request.headers.range === 'string' ? request.headers.range : undefined;
  const ifRangeHeader = typeof request.headers['if-range'] === 'string' ? request.headers['if-range'] : undefined;
  if (rangeHeader && ifRangeMatches(ifRangeHeader, etag, stat.mtimeMs)) {
    const range = parseByteRange(rangeHeader, stat.size);
    if (!range) {
      reply.code(416).header('Content-Range', `bytes */${stat.size}`).header('Content-Length', '0').send();
      return;
    }
    const length = range.end - range.start + 1;
    reply
      .code(206)
      .header('Content-Range', `bytes ${range.start}-${range.end}/${stat.size}`)
      .header('Content-Length', String(length));
    if (request.method === 'HEAD') { reply.send(); return; }
    reply.send(fsStreams.createReadStream(filePathFor(id), { start: range.start, end: range.end }));
    return;
  }

  reply.code(200).header('Content-Length', String(stat.size));
  if (request.method === 'HEAD') { reply.send(); return; }
  reply.send(fsStreams.createReadStream(filePathFor(id)));
}

export function registerAttachmentRoutes(fastify: FastifyInstance): void {
  fastify.post('/api/attachments/init', handleAttachmentInit);
  fastify.post('/api/attachments/:id/complete', handleAttachmentComplete);
  fastify.delete('/api/attachments/:id', handleAttachmentCancel);
  fastify.route<{ Params: { id: string } }>({ method: ['GET', 'HEAD'], url: '/uploads/:id', handler: serveUpload });

  // raw Buffer body, not JSON — scoped plugin for just these 2 routes:
  // swapping addContentTypeParser on the root instance would break JSON
  // parsing for every other /api/* route.
  fastify.register(async (scoped) => {
    scoped.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, payload, done) => done(null, payload));
    scoped.post('/api/attachments/:id/chunk/:index', { bodyLimit: config.UPLOAD_CHUNK_BYTES }, handleAttachmentChunk);
    scoped.post('/api/avatar', { bodyLimit: config.MAX_AVATAR_BYTES }, handleAvatarUpload);
  });
}

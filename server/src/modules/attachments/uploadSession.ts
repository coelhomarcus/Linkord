import fs from 'node:fs/promises';
import fsStreams from 'node:fs'; // only for createReadStream/createWriteStream (chunk assembly), see assembleChunks
import path from 'node:path';
import { config } from '../../config/env.js';

// Chunked upload for MAX_ATTACHMENT_BYTES (2GB): a single POST that size
// wouldn't survive most proxies or be safe to buffer in memory. Upload
// session state lives on disk only (no DB table) — deployment is single-
// instance, so there's no need to share it across processes. `uploadId`
// becomes the final attachment id directly, no rename step. This is the
// disk/session mechanics only — the Fastify HTTP handlers that drive it
// live in attachmentUploads.ts, the only consumer that needs both halves;
// app/bootstrap.ts (boot-time dir prep + hourly sweep) and the test suite
// only ever need this half.

export async function ensureUploadDir(): Promise<void> {
  await fs.mkdir(config.UPLOAD_DIR, { recursive: true });
}

export function sanitizeFileName(raw: unknown): string {
  const s = String(raw == null ? '' : raw).trim().replace(/[\r\n/\\]/g, '_').slice(0, 200);
  return s || 'arquivo';
}

export interface UploadManifest {
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

export function tmpDirFor(uploadId: string): string {
  return path.join(config.UPLOAD_DIR, 'tmp', uploadId);
}

export function manifestPathFor(uploadId: string): string {
  return path.join(tmpDirFor(uploadId), 'manifest.json');
}

export function chunkPathFor(uploadId: string, index: number): string {
  // zero-padded so alphabetical sort matches numeric sort
  return path.join(tmpDirFor(uploadId), String(index).padStart(6, '0'));
}

/** null if missing or corrupt — caller treats that as 404. */
export async function readManifest(uploadId: string): Promise<UploadManifest | null> {
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
export async function assembleChunks(uploadId: string, manifest: UploadManifest, destPath: string): Promise<void> {
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
export const pendingUploadBytes = new Map<string, number>();

export function getReservedBytes(): number {
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
export function withInitLock<T>(fn: () => Promise<T>): Promise<T> {
  const result = initLock.then(fn, fn);
  initLock = result.then(() => undefined, () => undefined);
  return result;
}

// serializes concurrent complete() calls for the SAME uploadId — without
// this, a duplicate client retry could try to assemble/write the same final
// file twice. Process-lifetime only (correctly resets on restart).
export const completingUploads = new Set<string>();

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

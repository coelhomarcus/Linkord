import fs from 'node:fs/promises';
import type { FastifyReply, FastifyRequest } from 'fastify';
import sharp from 'sharp';
import { config } from '../../config/env.js';
import { db } from '../../db/client.js';
import { attachments as attachmentsTable } from '../../db/schema.js';
import { sendJson, sendError } from '../../http/respond.js';
import { parseCookies } from '../../http/cookies.js';
import { resolveSession } from '../auth/session.js';
import { newId, filePathFor } from '../attachments/attachmentStorage.js';
import { getUsage } from '../attachments/attachmentQuota.js';
import { fetchImageFromUrl, AVATAR_MIME_TYPES } from './imageFetch.js';
import * as floodControl from '../../realtime/floodControl.js';
import { logger } from '../../lib/logger.js';

const log = logger.child({ component: 'avatar' });

const MAX_CROP_DIMENSION = 4096; // sane ceiling, well under sharp's own decompression-bomb guard

// This route had NO cap of any kind before — neither a per-request check nor
// a request-rate one — so a compromised account could hammer it (each hit
// doing real disk I/O, and for the "usar URL" flow a real outbound fetch)
// with nothing to stop it. 5/min is generous for an actual person picking a
// photo (including a few crop retries) and pointless to raise further —
// nobody legitimately changes their avatar faster than that.
const AVATAR_UPLOAD_LIMIT = { windowMs: 60_000, max: 5 };

export type CropRect = { left: number; top: number; width: number; height: number };

export class ProfileImageProcessingError extends Error {
  readonly code: 'invalid_crop' | 'crop_failed';

  constructor(code: 'invalid_crop' | 'crop_failed', message: string) {
    super(message);
    this.name = 'ProfileImageProcessingError';
    this.code = code;
  }
}

/** Parses the `?crop=` query param (JSON `{x,y,width,height}`, same shape as
 * react-easy-crop's `Area`) into the rect handleAvatarUpload extracts. */
export function parseCropRect(raw: string | undefined): CropRect | null {
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

/** Encodes and stores a profile image, extracted out of handleAvatarUpload
 * so the sharp pipeline itself (crop bounds, animation detection, poster
 * generation) is unit-testable without going through Fastify. `uploaderId`
 * is who gets to later claim this as their own avatar/banner/group avatar
 * (handleProfile/handleGroupUpdate check it) — see schema.ts#attachments. */
export async function encodeAndStoreProfileImage(
  buffer: Buffer,
  cropRect: CropRect,
  uploaderId: string,
): Promise<{ avatar: string; avatarPoster: string | undefined }> {
  let outBuffer: Buffer;
  let outMime: string;
  let animated = false;
  try {
    const image = sharp(buffer, { animated: true });
    const meta = await image.metadata();
    const frameHeight = meta.pageHeight ?? meta.height ?? 0;
    if (!meta.width || !frameHeight
      || cropRect.left + cropRect.width > meta.width
      || cropRect.top + cropRect.height > frameHeight) {
      throw new ProfileImageProcessingError('invalid_crop', 'Recorte fora dos limites da imagem.');
    }

    const extracted = image.extract(cropRect);
    animated = (meta.pages ?? 1) > 1;
    if (animated) {
      // animated: keep WebP inputs as WebP (better quality than GIF's
      // 256-color palette); anything else animated (GIF today) stays GIF.
      if (meta.format === 'webp') {
        outBuffer = await extracted.webp({ quality: 90 }).toBuffer();
        outMime = 'image/webp';
      } else {
        outBuffer = await extracted.gif().toBuffer();
        outMime = 'image/gif';
      }
    } else {
      outBuffer = await extracted.jpeg({ quality: 92 }).toBuffer();
      outMime = 'image/jpeg';
    }
  } catch (err) {
    if (err instanceof ProfileImageProcessingError) throw err;
    throw new ProfileImageProcessingError(
      'crop_failed',
      'Não foi possível processar a imagem.',
    );
  }

  const id = newId();
  await fs.writeFile(filePathFor(id), outBuffer);
  try {
    await db.insert(attachmentsTable).values({ id, messageId: null, uploaderId, fileName: 'avatar', mimeType: outMime, size: outBuffer.length });
  } catch (err) {
    await fs.unlink(filePathFor(id)).catch(() => {});
    throw err;
  }

  // For an animated avatar/banner, also freeze the first frame as a JPEG
  // "poster" — the call UI (Tile.tsx) shows this instead of the live
  // animation until the person actually speaks, same idea as Discord.
  // Best-effort: a failure here still leaves a perfectly good (animated)
  // avatar/banner, it just won't freeze in calls.
  let posterUrl: string | undefined;
  if (animated) {
    const posterId = newId();
    try {
      const posterBuffer = await sharp(buffer, { animated: false }).extract(cropRect).jpeg({ quality: 88 }).toBuffer();
      await fs.writeFile(filePathFor(posterId), posterBuffer);
      try {
        await db.insert(attachmentsTable).values({ id: posterId, messageId: null, uploaderId, fileName: 'avatar-poster', mimeType: 'image/jpeg', size: posterBuffer.length });
        posterUrl = `/uploads/${posterId}`;
      } catch (err) {
        await fs.unlink(filePathFor(posterId)).catch(() => {});
        throw err;
      }
    } catch (err) {
      log.warn('failed to generate avatar poster', { err: err instanceof Error ? err.message : String(err) });
    }
  }

  return { avatar: `/uploads/${id}`, avatarPoster: posterUrl };
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
 * attachments.ts#deleteAvatarFile).
 *
 * Instead of raw image bytes, the client may POST `application/json`
 * `{ url }` — the "usar URL" flow — in which case the image is downloaded
 * server-side first (see imageFetch.ts#fetchImageFromUrl) and then goes
 * through the exact same crop/encode path below. */
export async function handleAvatarUpload(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const cookies = parseCookies(request.headers.cookie || '');
  const sess = await resolveSession(cookies[config.SESSION_COOKIE]);
  if (!sess) return sendError(reply, 401, 'unauthenticated', 'Não autenticado.');

  if (!floodControl.allow(`avatar:${sess.userId}`, AVATAR_UPLOAD_LIMIT)) {
    return sendError(reply, 429, 'rate_limited', 'Muitas trocas de foto em pouco tempo. Tente de novo em instantes.');
  }

  const mimeType = String(request.headers['content-type'] || '').split(';')[0]!.trim();

  let buffer: Buffer;
  if (mimeType === 'application/json') {
    let payload: unknown;
    try {
      payload = JSON.parse((request.body as Buffer).toString('utf8'));
    } catch {
      return sendError(reply, 400, 'invalid_body', 'Corpo inválido.');
    }
    const sourceUrl = payload && typeof payload === 'object' ? (payload as Record<string, unknown>).url : undefined;
    if (typeof sourceUrl !== 'string' || !sourceUrl.trim()) {
      return sendError(reply, 400, 'invalid_url', 'URL inválida.');
    }
    const fetched = await fetchImageFromUrl(sourceUrl.trim(), config.MAX_AVATAR_BYTES);
    if ('error' in fetched) return sendError(reply, 400, fetched.error === '__redirect__' ? 'fetch_failed' : fetched.error, fetched.message);
    buffer = fetched.buffer;
  } else {
    if (!AVATAR_MIME_TYPES.has(mimeType)) {
      return sendError(reply, 400, 'invalid_type', 'Formato inválido. Use PNG, JPEG, GIF ou WEBP.');
    }
    buffer = request.body as Buffer;
    if (buffer.length === 0) return sendError(reply, 400, 'empty_file', 'Arquivo vazio.');
  }

  const cropRect = parseCropRect((request.query as Record<string, string | undefined>).crop);
  if (!cropRect) return sendError(reply, 400, 'invalid_crop', 'Recorte inválido.');

  // The instance-wide cap now includes avatars/banners too (see
  // attachmentQuota.ts#getUsage) — checked against the pre-encode buffer,
  // which is never smaller than what actually gets written to disk.
  const usage = await getUsage();
  if (usage.totalBytes + buffer.length > config.MAX_STORAGE_BYTES) {
    log.warn('avatar upload refused: instance storage is full', { userId: sess.userId, size: buffer.length });
    return sendError(reply, 400, 'storage_full', 'Armazenamento cheio (30GB no total). Tente novamente mais tarde.');
  }

  try {
    const result = await encodeAndStoreProfileImage(buffer, cropRect, sess.userId);
    return sendJson(reply, 201, result);
  } catch (err) {
    if (err instanceof ProfileImageProcessingError) {
      log.warn('failed to crop avatar', { err: err.message });
      return sendError(reply, 400, err.code, err.message);
    }
    log.warn('failed to crop avatar', { err: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}

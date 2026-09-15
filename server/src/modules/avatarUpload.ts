import fs from 'node:fs/promises';
import type { FastifyReply, FastifyRequest } from 'fastify';
import sharp from 'sharp';
import { config } from '../config/env.js';
import { db } from '../db/client.js';
import { attachments as attachmentsTable } from '../db/schema.js';
import { sendJson, sendError } from '../http/respond.js';
import { parseCookies } from '../http/cookies.js';
import { resolveSession } from './auth/session.js';
import { newId, filePathFor } from './attachmentStorage.js';
import { fetchImageFromUrl, AVATAR_MIME_TYPES } from './imageFetch.js';

const MAX_CROP_DIMENSION = 4096; // sane ceiling, well under sharp's own decompression-bomb guard

/** Parses the `?crop=` query param (JSON `{x,y,width,height}`, same shape as
 * react-easy-crop's `Area`) into the rect handleAvatarUpload extracts. */
export function parseCropRect(raw: string | undefined): { left: number; top: number; width: number; height: number } | null {
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
    if ('error' in fetched) return sendError(reply, 400, fetched.error, fetched.message);
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
    console.warn(`[attachments] falha ao recortar avatar: ${err instanceof Error ? err.message : err}`);
    return sendError(reply, 400, 'crop_failed', 'Não foi possível processar a imagem.');
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

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import fsStreams from 'node:fs'; // only for createReadStream, see serveUpload
import { eq } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../../config/env.js';
import { db } from '../../db/client.js';
import { attachments as attachmentsTable, messages, type Attachment } from '../../db/schema.js';
import { sendJson, sendError } from '../../http/respond.js';
import { parseCookies } from '../../http/cookies.js';
import { resolveSession } from '../auth/session.js';
import { conversationExistsForUser } from '../conversations/conversationsRepository.js';
import { filePathFor } from './attachmentStorage.js';

// Chat attachments are served (and previewed) from disk keyed by a uuid (no
// extension — real mime type lives in the mime_type column, never trust the
// name). Only a known list of image/video/audio mimes is served inline;
// everything else forces a download (prevents an uploaded .svg/.html from
// executing script on our own origin — see serveUpload).
const INLINE_MIME_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp',
  'video/mp4', 'video/webm', 'video/ogg',
  'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/mp4',
]);
const ID_RE = /^[0-9a-f]{32}$/; // crypto.randomUUID() without dashes, see attachmentStorage.ts#newId
const RANGE_RE = /^bytes=(\d*)-(\d*)$/; // single-range only — the only form <video>/<audio> ever sends

// Extensions eligible for the text/markdown/code preview (handleAttachmentPreview
// below). Extension, not client-declared mime — code files routinely arrive
// as application/octet-stream or '' depending on OS/browser, mime is not a
// reliable signal here. Mirrored on the frontend (web/src/features/chat/
// ChatAttachment.tsx) since web/ and server/ don't share a package.
const TEXT_PREVIEW_EXTENSIONS = new Set([
  'md', 'markdown', 'txt', 'json', 'jsonc', 'yaml', 'yml', 'csv', 'tsv', 'xml', 'log', 'env',
  'js', 'jsx', 'ts', 'tsx', 'py', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'hpp', 'cs', 'rb', 'php',
  'sh', 'bash', 'sql', 'css', 'scss', 'html', 'vue', 'toml', 'ini', 'diff', 'patch',
]);
// Extension -> language id, in the vocabulary the frontend's syntax
// highlighter expects — computed once here so the client never has to
// re-derive it from a filename.
const EXTENSION_LANGUAGE: Record<string, string> = {
  md: 'markdown', markdown: 'markdown',
  txt: 'text', log: 'text', env: 'text', csv: 'text', tsv: 'text',
  json: 'json', jsonc: 'jsonc', yaml: 'yaml', yml: 'yaml', xml: 'xml',
  js: 'javascript', jsx: 'jsx', ts: 'typescript', tsx: 'tsx',
  py: 'python', go: 'go', rs: 'rust', java: 'java',
  c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp', cs: 'csharp',
  rb: 'ruby', php: 'php', sh: 'bash', bash: 'bash',
  sql: 'sql', css: 'css', scss: 'scss', html: 'html', vue: 'vue',
  toml: 'toml', ini: 'ini', diff: 'diff', patch: 'diff',
};
const PREVIEW_MAX_BYTES = 65536;
const PREVIEW_MAX_LINES = 500;

/** ASCII fallback (`filename=`) plus a real UTF-8 filename* (RFC 5987),
 * which modern browsers prefer — handles accents/spaces/quotes safely. */
export function contentDispositionFor(kind: 'inline' | 'attachment', fileName: string): string {
  const asciiFallback = fileName.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, "'");
  return `${kind}; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

/** `messageId === null` rows are avatars/banners — public by design, any
 * logged-in user can already see anyone's profile picture. Everything else
 * is a chat attachment, gated by the SAME conversation-membership rule used
 * everywhere else message history is read (see modules/conversations.ts) —
 * no separate "ex-member" carve-out exists there, so none is invented here. */
async function canViewAttachment(row: Attachment, userId: string): Promise<boolean> {
  if (row.messageId === null) return true;
  const [msg] = await db.select({ conversationId: messages.conversationId }).from(messages).where(eq(messages.id, row.messageId)).limit(1);
  if (!msg) return false;
  return conversationExistsForUser(msg.conversationId, userId);
}

/** Avatars/banners are public by design and safe to cache for good. A chat
 * attachment is only readable by current members, so the browser must
 * revalidate on every use: the ETag is the (immutable) file id, and the 304
 * is only ever answered AFTER the membership check — a removed member's
 * cached copy of the URL stops resolving instead of replaying for a year. A
 * copy already downloaded can't be recalled (docs/plano-rede-social.md §11). */
export function cachePolicyFor(row: Pick<Attachment, 'id' | 'messageId'>, ifNoneMatch: string | undefined): {
  cacheControl: string; etag: string | null; notModified: boolean;
} {
  if (row.messageId === null) return { cacheControl: 'private, max-age=31536000, immutable', etag: null, notModified: false };
  const etag = `"${row.id}"`;
  const matches = (ifNoneMatch ?? '').split(',').map((v) => v.trim().replace(/^W\//, '')).includes(etag);
  return { cacheControl: 'private, no-cache', etag, notModified: matches };
}

/** Dev convenience only (see config.UPLOADS_REMOTE_URL) — pulls a file this
 * instance doesn't have on disk from the instance that does, and caches it
 * locally so it's a plain local read next time. Forwards the caller's own
 * session cookie: since both instances read the SAME `attachments`/`sessions`
 * rows (shared DATABASE_URL), a session valid here is valid there too — no
 * separate credential needed. Written to a temp file + renamed so a
 * concurrent request never reads a half-downloaded file. Returns false (and
 * leaves nothing on disk) on any failure — the caller just 404s as before. */
async function tryCacheFromRemote(id: string, cookieHeader: string): Promise<boolean> {
  if (!config.UPLOADS_REMOTE_URL) return false;
  const tmpPath = `${filePathFor(id)}.fetching-${crypto.randomUUID()}`;
  try {
    const res = await fetch(`${config.UPLOADS_REMOTE_URL}/uploads/${id}`, {
      headers: cookieHeader ? { cookie: cookieHeader } : {},
    });
    if (!res.ok || !res.body) return false;
    await fs.writeFile(tmpPath, Buffer.from(await res.arrayBuffer()));
    await fs.rename(tmpPath, filePathFor(id));
    return true;
  } catch (err) {
    console.warn(`[attachments] failed to fetch ${id} from UPLOADS_REMOTE_URL: ${err instanceof Error ? err.message : err}`);
    await fs.unlink(tmpPath).catch(() => {});
    return false;
  }
}

export async function serveUpload(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply): Promise<FastifyReply> {
  const cookies = parseCookies(request.headers.cookie || '');
  const sess = await resolveSession(cookies[config.SESSION_COOKIE]);
  if (!sess) return reply.code(401).send('não autenticado');

  const id = request.params.id;
  if (!ID_RE.test(id)) return reply.code(400).send('id inválido');

  const [row] = await db.select().from(attachmentsTable).where(eq(attachmentsTable.id, id)).limit(1);
  if (!row) return reply.code(404).send('não encontrado');
  // Same 404 as "row doesn't exist" — an unauthorized id must be
  // indistinguishable from a wrong one, or the response itself becomes an
  // oracle for probing which UUIDs are real.
  if (!(await canViewAttachment(row, sess.userId))) return reply.code(404).send('não encontrado');
  const policy = cachePolicyFor(row, request.headers['if-none-match']);
  if (policy.notModified) {
    return reply.code(304).header('ETag', policy.etag!).header('Cache-Control', policy.cacheControl).send();
  }

  const path = filePathFor(id);
  let size: number;
  try {
    size = (await fs.stat(path)).size;
  } catch {
    if (!(await tryCacheFromRemote(id, request.headers.cookie || ''))) return reply.code(404).send('não encontrado');
    try {
      size = (await fs.stat(path)).size;
    } catch {
      return reply.code(404).send('não encontrado');
    }
  }

  const inline = INLINE_MIME_TYPES.has(row.mimeType);
  const contentType = inline ? row.mimeType : 'application/octet-stream';
  const disposition = contentDispositionFor(inline ? 'inline' : 'attachment', row.fileName);
  const { cacheControl, etag } = cachePolicyFor(row, request.headers['if-none-match']);
  if (etag) reply.header('ETag', etag);

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

export function extensionOf(fileName: string): string {
  const match = /\.([^./\\]+)$/.exec(fileName);
  return match ? match[1]!.toLowerCase() : '';
}

export function isPreviewable(row: Attachment): boolean {
  return TEXT_PREVIEW_EXTENSIONS.has(extensionOf(row.fileName)) || row.mimeType.startsWith('text/');
}

/** Decodes a (possibly byte-truncated) buffer as UTF-8 text, trimming up to
 * 3 trailing bytes first if the cut landed mid multi-byte character — that's
 * the only reason a genuinely-text file's PREFIX would fail strict decoding.
 * Returns null (never throws) when it's not valid UTF-8 at all — the actual
 * "is this secretly binary" signal handleAttachmentPreview relies on. */
export function decodeUtf8Prefix(buffer: Buffer): string | null {
  for (let trim = 0; trim <= 3 && trim <= buffer.length; trim++) {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, buffer.length - trim));
    } catch { /* keep trimming */ }
  }
  return null;
}

/** GET /api/attachments/:id/preview — a size-capped, sniffed-as-text peek at
 * a chat attachment's content, for the inline text/markdown/code preview
 * card. Deliberately a SEPARATE endpoint from serveUpload/`/uploads/:id`
 * rather than just adding text/* to INLINE_MIME_TYPES there: serveUpload has
 * no concept of "first N KB only" (a text attachment can be up to
 * MAX_ATTACHMENT_BYTES = 2GiB) and no binary-sniffing — both of which matter
 * here but would be out of place bolted onto the real-download path. */
export async function handleAttachmentPreview(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply): Promise<void> {
  const cookies = parseCookies(request.headers.cookie || '');
  const sess = await resolveSession(cookies[config.SESSION_COOKIE]);
  if (!sess) return sendError(reply, 401, 'unauthenticated', 'Não autenticado.');

  const id = request.params.id;
  if (!ID_RE.test(id)) return sendError(reply, 400, 'invalid_id', 'Id inválido.');

  const [row] = await db.select().from(attachmentsTable).where(eq(attachmentsTable.id, id)).limit(1);
  if (!row || !(await canViewAttachment(row, sess.userId))) return sendError(reply, 404, 'not_found', 'Não encontrado.');

  // Defense in depth — don't just trust the frontend's own extension gate.
  if (!isPreviewable(row)) return sendJson(reply, 200, { previewable: false });

  let buffer: Buffer;
  try {
    const handle = await fs.open(filePathFor(id), 'r');
    try {
      buffer = Buffer.alloc(Math.min(PREVIEW_MAX_BYTES, row.size));
      await handle.read(buffer, 0, buffer.length, 0);
    } finally {
      await handle.close();
    }
  } catch {
    return sendJson(reply, 200, { previewable: false });
  }

  const text = decodeUtf8Prefix(buffer);
  if (text === null) return sendJson(reply, 200, { previewable: false }); // secretly binary

  const lines = text.split('\n');
  const byteTruncated = row.size > buffer.length;
  const lineTruncated = lines.length > PREVIEW_MAX_LINES;
  const content = lineTruncated ? lines.slice(0, PREVIEW_MAX_LINES).join('\n') : text;

  sendJson(reply, 200, {
    previewable: true,
    content,
    truncated: byteTruncated || lineTruncated,
    totalSize: row.size,
    language: EXTENSION_LANGUAGE[extensionOf(row.fileName)] ?? null,
  });
}

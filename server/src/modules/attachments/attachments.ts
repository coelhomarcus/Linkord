import fs from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import { eq, and, asc, inArray, isNull } from 'drizzle-orm';
import { config } from '../../config/env.js';
import { db } from '../../db/client.js';
import { attachments as attachmentsTable, messages, type Attachment } from '../../db/schema.js';
import { filePathFor } from './attachmentStorage.js';
import { handleAttachmentInit, handleAttachmentChunk, handleAttachmentComplete, handleAttachmentCancel } from './attachmentUploads.js';
import { serveUpload, handleAttachmentPreview } from './attachmentServing.js';
import { handleAvatarUpload } from './avatarUpload.js';

// This module is now just the DB-persistence core for attachments (CRUD +
// route wiring) — the upload lifecycle, file-serving/preview, thumbnail
// generation, avatar upload, and SSRF-guarded image fetch each moved to
// their own sibling module (attachmentUploads.ts, attachmentServing.ts,
// attachmentThumbnails.ts, avatarUpload.ts, imageFetch.ts) since none of
// those are really about "the attachments table," and mixing them here made
// this file the single largest in the server. Nothing outside this file
// needs to know about the split — every external import
// (chat.ts/socket.ts/http/app.ts/moderation.ts/index.ts) keeps working
// unchanged, either against this file or the sibling it actually needs.

// only matches our own upload format (see attachmentStorage.ts#newId) — an
// external URL just doesn't match, treated as "not ours," not an error.
const AVATAR_URL_RE = /^\/uploads\/([0-9a-f]{32})$/;

/** One query for all messages' attachments (avoids N+1). Up to
 * MAX_ATTACHMENTS_PER_MESSAGE rows per message now (see
 * attachmentUploads.ts#handleAttachmentComplete's targetMsgId path) —
 * ordered by createdAt so multi-attachment order survives (attachments
 * upload sequentially, client-side, so createdAt timestamps never collide
 * in practice). */
export async function getByMessageIds(messageIds: number[]): Promise<Map<number, Attachment[]>> {
  const map = new Map<number, Attachment[]>();
  if (!messageIds.length) return map;
  const rows = await db.select().from(attachmentsTable)
    // isThumbnail rows share their parent's messageId on purpose (see
    // schema.ts) but must never surface as a second, duplicate attachment.
    .where(and(inArray(attachmentsTable.messageId, messageIds), eq(attachmentsTable.isThumbnail, false)))
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

export function registerAttachmentRoutes(fastify: FastifyInstance): void {
  fastify.post('/api/attachments/init', handleAttachmentInit);
  fastify.post('/api/attachments/:id/complete', handleAttachmentComplete);
  fastify.delete('/api/attachments/:id', handleAttachmentCancel);
  fastify.get('/uploads/:id', serveUpload);
  fastify.get('/api/attachments/:id/preview', handleAttachmentPreview);

  // raw Buffer body, not JSON — scoped plugin for just these 2 routes:
  // swapping addContentTypeParser on the root instance would break JSON
  // parsing for every other /api/* route. The wildcard '*' alone does NOT
  // cover this: Fastify's own built-in default parser for the EXACT type
  // 'application/json' takes precedence over a wildcard parser, even one
  // registered in a child scope — so /api/avatar's `{ url }` JSON body (see
  // avatarUpload.ts) was arriving already parsed into an object, and that
  // handler's `(request.body as Buffer).toString('utf8')` was silently
  // producing "[object Object]" instead of the real JSON, always failing
  // with 'invalid_body'. Registering 'application/json' explicitly (not
  // just '*') here overrides the built-in default within this scope only.
  fastify.register(async (scoped) => {
    scoped.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, payload, done) => done(null, payload));
    scoped.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, payload, done) => done(null, payload));
    scoped.post('/api/attachments/:id/chunk/:index', { bodyLimit: config.UPLOAD_CHUNK_BYTES }, handleAttachmentChunk);
    scoped.post('/api/avatar', { bodyLimit: config.MAX_AVATAR_BYTES }, handleAvatarUpload);
  });
}

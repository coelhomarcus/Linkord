import type { FastifyInstance } from 'fastify';
import { eq, and, asc, inArray } from 'drizzle-orm';
import { config } from '../../config/env.js';
import { db } from '../../db/client.js';
import { attachments as attachmentsTable, type Attachment } from '../../db/schema.js';
import { handleAttachmentInit, handleAttachmentChunk, handleAttachmentComplete, handleAttachmentCancel } from './attachmentUploads.js';
import { serveUpload, handleAttachmentPreview } from './attachmentServing.js';

// This module is now just the DB-persistence core for attachments (CRUD +
// route wiring) — the upload lifecycle, file-serving/preview, and thumbnail
// generation each moved to their own sibling module (attachmentUploads.ts,
// attachmentServing.ts, attachmentThumbnails.ts) since none of those are
// really about "the attachments table." Deleting files when their owner
// disappears (a message, a conversation, an avatar) lives in
// attachmentCleanup.ts instead — messages.ts/conversations.ts/participants.ts/
// moderation.ts all need it, and it has to stay a leaf module (no dependency
// on this file or its attachmentUploads.js/attachmentServing.js imports) so
// those 4 callers can import it statically without a cycle. Avatar upload
// and its SSRF-guarded image fetch live in modules/profile/ instead — a
// different domain that happens to share this table's storage.

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

export function registerAttachmentRoutes(fastify: FastifyInstance): void {
  fastify.post('/api/attachments/init', handleAttachmentInit);
  fastify.post('/api/attachments/:id/complete', handleAttachmentComplete);
  fastify.delete('/api/attachments/:id', handleAttachmentCancel);
  fastify.get('/uploads/:id', serveUpload);
  fastify.get('/api/attachments/:id/preview', handleAttachmentPreview);

  // raw Buffer body, not JSON — scoped plugin for just this route: swapping
  // addContentTypeParser on the root instance would break JSON parsing for
  // every other /api/* route. Chunk uploads are always binary, never
  // application/json, so the wildcard '*' alone is enough here (contrast
  // modules/profile/profile.ts's /api/avatar, which also needs a JSON
  // override for its "usar URL" flow).
  fastify.register(async (scoped) => {
    scoped.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, payload, done) => done(null, payload));
    scoped.post('/api/attachments/:id/chunk/:index', { bodyLimit: config.UPLOAD_CHUNK_BYTES }, handleAttachmentChunk);
  });
}

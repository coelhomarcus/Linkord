import fs from 'node:fs/promises';
import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { attachments, stagedAttachments, type Attachment, type StagedAttachment } from '../../db/schema.js';
import { filePathFor } from './attachmentStorage.js';

// Leaf module (db, schema and attachmentStorage only): the upload flow stages
// files here and the message send publishes them, and neither may import the
// other without closing a cycle through attachments.ts.

// Long enough to finish a slow batch and retry a failed send; after that the
// file is dropped and has to be picked again.
export const STAGED_TTL_MS = 24 * 60 * 60 * 1000;

export class StagedUnavailableError extends Error {
  constructor() { super('staged_attachments_unavailable'); }
}

export async function stageFile(values: Omit<typeof stagedAttachments.$inferInsert, 'expiresAt' | 'createdAt'>): Promise<StagedAttachment> {
  const [row] = await db.insert(stagedAttachments).values({ ...values, expiresAt: new Date(Date.now() + STAGED_TTL_MS) }).returning();
  return row!;
}

export async function findOwnedStaged(id: string, ownerId: string): Promise<StagedAttachment | null> {
  const [row] = await db.select().from(stagedAttachments).where(and(eq(stagedAttachments.id, id), eq(stagedAttachments.ownerId, ownerId))).limit(1);
  return row ?? null;
}

async function unlinkStagedFiles(rows: Pick<StagedAttachment, 'id' | 'thumbId'>[]): Promise<void> {
  for (const row of rows) {
    await fs.unlink(filePathFor(row.id)).catch(() => {});
    if (row.thumbId) await fs.unlink(filePathFor(row.thumbId)).catch(() => {});
  }
}

/** The owner gave up on this file (removed it from the tray, discarded the send). */
export async function discardStaged(id: string, ownerId: string): Promise<boolean> {
  const removed = await db.delete(stagedAttachments)
    .where(and(eq(stagedAttachments.id, id), eq(stagedAttachments.ownerId, ownerId)))
    .returning({ id: stagedAttachments.id, thumbId: stagedAttachments.thumbId });
  await unlinkStagedFiles(removed);
  return removed.length > 0;
}

export async function sweepExpiredStaged(now = Date.now()): Promise<number> {
  const removed = await db.delete(stagedAttachments)
    .where(lt(stagedAttachments.expiresAt, new Date(now)))
    .returning({ id: stagedAttachments.id, thumbId: stagedAttachments.thumbId });
  await unlinkStagedFiles(removed);
  return removed.length;
}

/** Bytes waiting in staging — for one owner, or the whole instance. They
 * are on disk already, so they count against the quota like stored files. */
export async function stagedBytes(ownerId?: string): Promise<{ bytes: number; files: number }> {
  const [row] = await db.select({
    bytes: sql<number>`coalesce(sum(${stagedAttachments.size} + coalesce(${stagedAttachments.thumbSize}, 0)), 0)::float8`,
    files: sql<number>`count(*)::int`,
  }).from(stagedAttachments).where(ownerId ? eq(stagedAttachments.ownerId, ownerId) : undefined);
  return { bytes: Number(row?.bytes ?? 0), files: Number(row?.files ?? 0) };
}

/** Ids the orphan sweeper must treat as referenced, originals and thumbnails. */
export async function stagedFileIds(): Promise<string[]> {
  const rows = await db.select({ id: stagedAttachments.id, thumbId: stagedAttachments.thumbId }).from(stagedAttachments);
  return rows.flatMap((row) => (row.thumbId ? [row.id, row.thumbId] : [row.id]));
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Inside the send's transaction: turns the staged files into the message's
 * attachments, in the given order. All or nothing — any id that isn't this
 * owner's, for this conversation, still staged, aborts the whole send. */
export async function publishStaged(tx: Tx, args: { ids: string[]; ownerId: string; conversationId: string; messageId: number }): Promise<Attachment[]> {
  if (!args.ids.length) return [];
  const rows = await tx.select().from(stagedAttachments)
    .where(and(inArray(stagedAttachments.id, args.ids), eq(stagedAttachments.ownerId, args.ownerId), eq(stagedAttachments.conversationId, args.conversationId)))
    .for('update');
  if (rows.length !== args.ids.length) throw new StagedUnavailableError();
  const byId = new Map(rows.map((row) => [row.id, row]));
  const published: Attachment[] = [];
  for (const [position, id] of args.ids.entries()) {
    const staged = byId.get(id)!;
    if (staged.thumbId) {
      await tx.insert(attachments).values({
        id: staged.thumbId, messageId: args.messageId, fileName: staged.fileName, mimeType: staged.thumbMimeType ?? staged.mimeType,
        size: staged.thumbSize ?? 0, isThumbnail: true, position,
      });
    }
    const [row] = await tx.insert(attachments).values({
      id: staged.id, messageId: args.messageId, fileName: staged.fileName, mimeType: staged.mimeType, size: staged.size,
      thumbId: staged.thumbId, position,
    }).returning();
    published.push(row!);
  }
  await tx.delete(stagedAttachments).where(inArray(stagedAttachments.id, args.ids));
  return published;
}

import { and, count, eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { attachments, messages } from '../../db/schema.js';

// Leaf module (db/schema only): both messages.ts and the attachment upload
// flow build reply references, and attachmentUploads.ts can't import
// messages.ts without closing a cycle through attachments.ts.

const REPLY_PREVIEW_LEN = 120;

export interface ReplyRef {
  msgId: number;
  authorId: string | null;
  text: string;
  attachmentCount?: number;
}

export function normalizeReplyRef(raw: unknown): ReplyRef | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  const msgId = Number(obj.msgId);
  if (!Number.isFinite(msgId)) return undefined;
  const ref: ReplyRef = {
    msgId,
    authorId: typeof obj.authorId === 'string' && obj.authorId ? obj.authorId : null,
    text: String(obj.text == null ? '' : obj.text).slice(0, REPLY_PREVIEW_LEN),
  };
  const attachmentCount = Number(obj.attachmentCount);
  if (Number.isFinite(attachmentCount) && attachmentCount > 0) ref.attachmentCount = attachmentCount;
  return ref;
}

/** Builds a compact reference to the original message from the client's
 * msgId. It stores the original author's user id, not mutable profile data,
 * so reply previews follow profile changes too. Silently returns undefined
 * if it's gone (deleted) or from another conversation, so the reply just carries
 * no reference instead of failing outright. */
export async function buildReplyRef(conversationId: string, replyToId: unknown): Promise<ReplyRef | undefined> {
  if (replyToId == null) return undefined;
  const id = Number(replyToId);
  if (!Number.isFinite(id)) return undefined;
  const [original] = await db
    .select({ id: messages.id, authorId: messages.authorId, text: messages.text, kind: messages.kind })
    .from(messages)
    .where(and(eq(messages.id, id), eq(messages.conversationId, conversationId)))
    .limit(1);
  // a card can't be replied to — its preview would be blank, and answering
  // an invitation is what its own buttons are for
  if (!original || original.kind !== 'text') return undefined;
  const ref: ReplyRef = { msgId: original.id, authorId: original.authorId, text: original.text.slice(0, REPLY_PREVIEW_LEN) };
  // no caption on the original — likely an attachment-only message. Lets
  // the reply reference show "📎 N anexos" instead of a blank snippet.
  if (!ref.text) {
    const [row] = await db.select({ n: count() }).from(attachments)
      .where(and(eq(attachments.messageId, original.id), eq(attachments.isThumbnail, false)));
    if (row && row.n > 0) ref.attachmentCount = row.n;
  }
  return ref;
}

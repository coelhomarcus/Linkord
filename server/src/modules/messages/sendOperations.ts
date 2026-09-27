import crypto from 'node:crypto';
import { and, eq, lt } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { messageSendOperations, messages, type Attachment, type Message } from '../../db/schema.js';

// A retry can only be told apart from a new message by the key the client
// chose for its intent; this long is enough for any client still retrying.
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const CLIENT_MESSAGE_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

export function isValidClientMessageId(value: unknown): value is string {
  return typeof value === 'string' && CLIENT_MESSAGE_ID_RE.test(value);
}

/** Canonical hash of what a send asks for — the key alone can't tell a
 * retry from a reused key with different content. */
export function sendPayloadHash(payload: { conversationId: string; text: string; replyTo: number | null; attachmentIds?: string[] }): string {
  const parts: unknown[] = [payload.conversationId, payload.text, payload.replyTo];
  // appended only when present, so a text-only send hashes as it always has
  if (payload.attachmentIds?.length) parts.push(payload.attachmentIds);
  return crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

export type SendOutcome =
  | { status: 'created'; row: Message; attachments: Attachment[] }
  | { status: 'duplicate'; messageId: number }
  | { status: 'deleted' }
  | { status: 'conflict' };

/** Inserts the message at most once per (author, clientMessageId). A retry
 * racing the original blocks on the primary key until the first commits,
 * then reads its outcome — never a second row. */
export async function insertMessageOnce(args: {
  authorId: string;
  clientMessageId: string;
  payloadHash: string;
  values: typeof messages.$inferInsert;
  /** Runs in the same transaction, after the message row exists — a throw
   * here undoes the message and the claim, leaving the key free to retry. */
  attach?: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0], row: Message) => Promise<Attachment[]>;
}): Promise<SendOutcome> {
  return db.transaction(async (tx) => {
    const claimed = await tx.insert(messageSendOperations)
      .values({ authorId: args.authorId, clientMessageId: args.clientMessageId, payloadHash: args.payloadHash })
      .onConflictDoNothing()
      .returning({ authorId: messageSendOperations.authorId });
    if (!claimed.length) {
      const [op] = await tx.select().from(messageSendOperations).where(and(
        eq(messageSendOperations.authorId, args.authorId),
        eq(messageSendOperations.clientMessageId, args.clientMessageId),
      ));
      if (!op || op.payloadHash !== args.payloadHash) return { status: 'conflict' };
      // message_id is set in the same transaction as the insert, so null
      // here can only mean the message was deleted since
      if (op.messageId == null) return { status: 'deleted' };
      return { status: 'duplicate', messageId: op.messageId };
    }
    const [row] = await tx.insert(messages).values(args.values).returning();
    await tx.update(messageSendOperations).set({ messageId: row!.id }).where(and(
      eq(messageSendOperations.authorId, args.authorId),
      eq(messageSendOperations.clientMessageId, args.clientMessageId),
    ));
    const attached = args.attach ? await args.attach(tx, row!) : [];
    return { status: 'created', row: row!, attachments: attached };
  });
}

export async function sweepSendOperations(now = Date.now()): Promise<number> {
  const removed = await db.delete(messageSendOperations)
    .where(lt(messageSendOperations.createdAt, new Date(now - RETENTION_MS)))
    .returning({ authorId: messageSendOperations.authorId });
  return removed.length;
}

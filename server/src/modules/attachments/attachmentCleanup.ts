import fs from 'node:fs/promises';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { attachments as attachmentsTable, messages } from '../../db/schema.js';
import { filePathFor } from './attachmentStorage.js';

// Deleting the on-disk file(s) when whatever owned them (a message, a whole
// conversation, an account/group avatar) goes away. Kept in its own leaf
// file, same reasoning as attachmentStorage.ts: messages.ts, conversations.ts/
// conversationsRepository.ts, presence/participants.ts and moderation.ts all
// need this, and none of it depends on anything conversations/participants-
// related — putting it here (rather than in attachments.ts, which pulls in
// attachmentUploads.ts/attachmentServing.ts, which in turn depend on
// conversationsRepository.ts) means those 4 callers can import it statically
// instead of needing a dynamic `import()` to dodge a cycle.

// only matches our own upload format (see attachmentStorage.ts#newId) — an
// external URL just doesn't match, treated as "not ours," not an error.
const AVATAR_URL_RE = /^\/uploads\/([0-9a-f]{32})$/;

/** Deletes the on-disk file(s) only — the DB row(s) disappear via CASCADE
 * when the message is deleted right after (see modules/messages/messages.ts).
 * Postgres doesn't know about the file, so that part has to happen
 * separately. */
export async function deleteForMessage(messageId: number): Promise<void> {
  const rows = await db.select().from(attachmentsTable).where(eq(attachmentsTable.messageId, messageId));
  await Promise.all(rows.map((row) => fs.unlink(filePathFor(row.id)).catch((err: NodeJS.ErrnoException) => { if (err.code !== 'ENOENT') throw err; })));
}

/** Same idea in bulk — deleting a conversation CASCADEs messages/attachments
 * in Postgres without going through deleteForMessage, so this exists purely
 * to avoid orphaned files. Called by modules/conversations/ before the
 * delete. */
export async function deleteForConversation(conversationId: string): Promise<void> {
  const rows = await db
    .select({ id: attachmentsTable.id })
    .from(attachmentsTable)
    .innerJoin(messages, eq(attachmentsTable.messageId, messages.id))
    .where(eq(messages.conversationId, conversationId));
  await Promise.all(rows.map((row) => fs.unlink(filePathFor(row.id)).catch((err: NodeJS.ErrnoException) => { if (err.code !== 'ENOENT') throw err; })));
}

/** Deletes the OLD avatar file+row when an account or group switches to a
 * new one — otherwise old avatars pile up orphaned forever. No-ops for an
 * external URL or empty value. `isNull(messageId)` is a second guard so a
 * manipulated value could never delete a real chat attachment. */
export async function deleteAvatarFile(avatarValue: unknown): Promise<void> {
  const match = AVATAR_URL_RE.exec(String(avatarValue == null ? '' : avatarValue));
  if (!match) return;
  const id = match[1]!;
  const deleted = await db.delete(attachmentsTable).where(and(eq(attachmentsTable.id, id), isNull(attachmentsTable.messageId))).returning({ id: attachmentsTable.id });
  if (!deleted.length) return; // wasn't actually an avatar row — leave the file alone
  await fs.unlink(filePathFor(id)).catch((err: NodeJS.ErrnoException) => { if (err.code !== 'ENOENT') throw err; });
}

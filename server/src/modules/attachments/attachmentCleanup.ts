import fs from 'node:fs/promises';
import { and, eq, isNull, or } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { attachments as attachmentsTable, conversations, messages, users } from '../../db/schema.js';
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

/** Whether `url` (already passed through sanitizeAvatar/sanitizeBanner) is
 * safe for `uploaderId` to claim as their own avatar/banner/group avatar.
 * True for anything that isn't a LOCAL upload reference — an external
 * https:// URL or an empty string has no file of ours to protect. For a
 * local `/uploads/<id>` reference, only true when it's a genuine, still a
 * profile-image row (messageId null) that THIS account itself uploaded.
 *
 * Without this, sanitizeAvatar's format check alone let ANY account claim
 * ANY other account's `/uploads/<id>` profile image as its own — the id is
 * a public, observable string, free to copy out of someone else's profile.
 * The eventual replacement of that fraudulent reference would then delete
 * the real owner's still-in-use file via deleteAvatarFile below — this is
 * the write-time half of that fix; deleteAvatarFile's own reference check
 * is the read-time half (defense in depth for anything that predates this
 * or reaches it some other way). */
export async function isOwnedProfileImage(url: string, uploaderId: string): Promise<boolean> {
  const match = AVATAR_URL_RE.exec(url);
  if (!match) return true;
  const id = match[1]!;
  const [row] = await db.select({ id: attachmentsTable.id }).from(attachmentsTable)
    .where(and(eq(attachmentsTable.id, id), isNull(attachmentsTable.messageId), eq(attachmentsTable.uploaderId, uploaderId)))
    .limit(1);
  return !!row;
}

/** Whether some OTHER account's avatar/banner or group's avatar is still
 * literally set to this exact URL right now — deleteAvatarFile's caller
 * always updates ITS OWN row to the new value before calling this for the
 * old one (see presence/participants.ts#handleProfile,
 * conversations.ts#handleGroupUpdate), so if the string still turns up
 * anywhere in `users`/`conversations` at this point, it's necessarily a
 * DIFFERENT account/group still actively using it. */
async function isProfileImageStillReferenced(url: string): Promise<boolean> {
  const [byUser] = await db.select({ id: users.id }).from(users)
    .where(or(eq(users.avatar, url), eq(users.avatarPoster, url), eq(users.banner, url), eq(users.bannerPoster, url)))
    .limit(1);
  if (byUser) return true;
  const [byGroup] = await db.select({ id: conversations.id }).from(conversations).where(eq(conversations.avatar, url)).limit(1);
  return !!byGroup;
}

/** Deletes the OLD avatar file+row when an account or group switches to a
 * new one — otherwise old avatars pile up orphaned forever. No-ops for an
 * external URL or empty value. `isNull(messageId)` is a guard so a
 * manipulated value could never delete a real chat attachment; the
 * still-referenced check right before is what stops it from deleting a
 * DIFFERENT account's (or group's) current avatar/banner — see
 * isOwnedProfileImage's own comment for how such a reference could exist
 * at all. */
export async function deleteAvatarFile(avatarValue: unknown): Promise<void> {
  const match = AVATAR_URL_RE.exec(String(avatarValue == null ? '' : avatarValue));
  if (!match) return;
  const id = match[1]!;
  const url = `/uploads/${id}`;
  if (await isProfileImageStillReferenced(url)) return;
  const deleted = await db.delete(attachmentsTable).where(and(eq(attachmentsTable.id, id), isNull(attachmentsTable.messageId))).returning({ id: attachmentsTable.id });
  if (!deleted.length) return; // wasn't actually an avatar row — leave the file alone
  await fs.unlink(filePathFor(id)).catch((err: NodeJS.ErrnoException) => { if (err.code !== 'ENOENT') throw err; });
}

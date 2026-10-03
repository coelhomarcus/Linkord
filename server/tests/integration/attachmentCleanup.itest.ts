import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { attachments as attachmentsTable, conversations, users } from '../../src/db/schema.js';
import { deleteAvatarFile } from '../../src/modules/attachments/attachmentCleanup.js';
import { db, makeGroupWithMembers, makeUser, pool } from './helpers.js';

after(() => pool.end());

async function makeAvatarRow(uploaderId: string): Promise<string> {
  const id = crypto.randomUUID().replace(/-/g, '');
  await pool.query(
    "insert into attachments (id, message_id, uploader_id, file_name, mime_type, size) values ($1, null, $2, 'avatar', 'image/jpeg', 1)",
    [id, uploaderId],
  );
  return id;
}

async function attachmentExists(id: string): Promise<boolean> {
  const [row] = await db.select({ id: attachmentsTable.id }).from(attachmentsTable).where(eq(attachmentsTable.id, id));
  return !!row;
}

// deleteAvatarFile's caller (handleProfile/handleGroupUpdate) always
// persists the NEW value first, then calls this for the OLD one — these
// tests skip straight to that second half, wiring `users`/`conversations`
// rows directly to reproduce "the old value is still someone else's current
// one" without needing a real handler round-trip.

describe('deleteAvatarFile — never deletes a file another account/group still uses (real Postgres)', () => {
  it('another account still has this URL as its own avatar: does not delete', async () => {
    const id = await makeAvatarRow((await makeUser('ac')).id);
    const url = `/uploads/${id}`;
    const stillUsingIt = await makeUser('ac');
    await db.update(users).set({ avatar: url }).where(eq(users.id, stillUsingIt.id));

    await deleteAvatarFile(url);

    assert.equal(await attachmentExists(id), true, 'the row should not have been deleted');
  });

  it('another account still has this URL as its own banner: does not delete', async () => {
    const id = await makeAvatarRow((await makeUser('ac')).id);
    const url = `/uploads/${id}`;
    const stillUsingIt = await makeUser('ac');
    await db.update(users).set({ banner: url }).where(eq(users.id, stillUsingIt.id));

    await deleteAvatarFile(url);

    assert.equal(await attachmentExists(id), true);
  });

  it('a group still has this URL as its own avatar: does not delete', async () => {
    const owner = await makeUser('ac');
    const id = await makeAvatarRow(owner.id);
    const url = `/uploads/${id}`;
    const groupId = await makeGroupWithMembers(owner.id, []);
    await db.update(conversations).set({ avatar: url }).where(eq(conversations.id, groupId));

    await deleteAvatarFile(url);

    assert.equal(await attachmentExists(id), true);
  });

  it('nobody else references this URL: deletes normally', async () => {
    const id = await makeAvatarRow((await makeUser('ac')).id);
    const url = `/uploads/${id}`;

    await deleteAvatarFile(url);

    assert.equal(await attachmentExists(id), false, 'with no references at all, cleanup should have happened');
  });
});

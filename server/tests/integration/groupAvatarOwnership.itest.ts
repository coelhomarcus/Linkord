import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { eq } from 'drizzle-orm';
import { conversations } from '../../src/db/schema.js';
import { handlers } from '../../src/modules/conversations/conversations.js';
import { cleanupParticipant, db, joinNew, makeGroupWithMembers, makeOwnedAvatarUpload, makeUser, pool } from './helpers.js';

// handleGroupUpdate's avatar field goes through the exact same ownership
// check (isOwnedProfileImage) handleProfile's does — see
// profileUpdate.itest.ts for the check's own coverage. This file only
// proves the WIRING: the group's owner really can set the group's avatar
// to their own upload, and can't claim someone else's.

after(() => pool.end());

describe('handleGroupUpdate: avatar also goes through the ownership check (real Postgres)', () => {
  it('owner uses their own upload as the group avatar: accepted normally', async () => {
    const owner = await makeUser('gu');
    const groupId = await makeGroupWithMembers(owner.id, []);
    const { socket, participant } = joinNew(owner);
    try {
      const avatarUrl = await makeOwnedAvatarUpload(owner.id);
      await handlers['group-update'](socket, { conversationId: groupId, avatar: avatarUrl });

      const [row] = await db.select().from(conversations).where(eq(conversations.id, groupId));
      assert.equal(row!.avatar, avatarUrl);
    } finally {
      cleanupParticipant(participant);
    }
  });

  it('owner tries to use another account\'s upload as the group avatar: refused (stays empty)', async () => {
    // the same bug as handleProfile's, just reached from the group side: the
    // id is a public, observable string — nothing but this check stopped a
    // group owner from claiming another account's own avatar upload.
    const owner = await makeUser('gu');
    const stranger = await makeUser('gu');
    const groupId = await makeGroupWithMembers(owner.id, []);
    const { socket, participant } = joinNew(owner);
    try {
      const strangersAvatar = await makeOwnedAvatarUpload(stranger.id);
      await handlers['group-update'](socket, { conversationId: groupId, avatar: strangersAvatar });

      const [row] = await db.select().from(conversations).where(eq(conversations.id, groupId));
      assert.equal(row!.avatar, '', 'a reference the owner did not upload should become empty, not be accepted');
    } finally {
      cleanupParticipant(participant);
    }
  });
});

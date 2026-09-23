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

describe('handleGroupUpdate: avatar tambem passa pelo check de propriedade (Postgres real)', () => {
  it('dono usa um upload proprio como avatar do grupo: aceito normalmente', async () => {
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

  it('dono tenta usar o upload de outra conta como avatar do grupo: recusado (fica vazio)', async () => {
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
      assert.equal(row!.avatar, '', 'uma referencia que o dono nao upou deveria virar vazio, nao ser aceita');
    } finally {
      cleanupParticipant(participant);
    }
  });
});

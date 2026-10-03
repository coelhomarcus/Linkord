import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { eq } from 'drizzle-orm';
import { users } from '../../src/db/schema.js';
import { handlers } from '../../src/modules/presence/participants.js';
import { cleanupParticipant, db, joinNew, makeOwnedAvatarUpload, makeUser, pool } from './helpers.js';

// handleProfile hits the real `users` table (updateProfile), unlike every
// other participants.ts handler — the unit suite never touches a database
// (see AGENTS.md), so its persist-before-confirm/broadcast contract, the
// per-account serialization and the image/text isolation live here instead.

after(() => pool.end());

describe('handleProfile: persists before confirming/broadcasting (real Postgres)', () => {
  it('success: writes to the database, broadcasts and replies profile-result ok with the requestId', async () => {
    const user = await makeUser('pu');
    const { socket, sent, participant } = joinNew(user);
    try {
      await handlers.profile(socket, { requestId: 'r1', displayName: 'New Name', bio: 'new bio' });

      const [row] = await db.select().from(users).where(eq(users.id, user.id));
      assert.equal(row!.displayName, 'New Name');
      assert.equal(row!.bio, 'new bio');

      // ok:true always carries the full confirmed profile (not just the
      // patched keys) — the client reconciles its draft against this, and a
      // partial reply would leave it guessing what the untouched fields are
      const ok = sent.find((e) => e.payload?.t === 'profile-result');
      assert.deepEqual(ok?.payload, {
        t: 'profile-result', requestId: 'r1', ok: true,
        avatar: '', avatarPoster: '', avatarColor: 'blurple', displayName: 'New Name',
        banner: '', bannerPoster: '', bio: 'new bio', profileLinks: [],
      });
      assert.ok(sent.some((e) => e.payload?.t === 'participant-updated'), 'should have broadcast participant-updated');
      assert.equal(participant.displayName, 'New Name');
    } finally {
      cleanupParticipant(participant);
    }
  });

  it('account deleted mid-session: replies not_found, does not broadcast, and does not change the in-memory participant', async () => {
    const user = await makeUser('pu');
    const { socket, sent, participant } = joinNew(user);
    try {
      await db.delete(users).where(eq(users.id, user.id));
      await handlers.profile(socket, { requestId: 'r2', displayName: 'Ghost' });

      const result = sent.find((e) => e.payload?.t === 'profile-result');
      assert.deepEqual(result?.payload, { t: 'profile-result', requestId: 'r2', ok: false, code: 'not_found', message: 'Sua conta não foi encontrada.' });
      assert.ok(!sent.some((e) => e.payload?.t === 'participant-updated'), 'should not have broadcast anything');
      assert.notEqual(participant.displayName, 'Ghost');
    } finally {
      cleanupParticipant(participant);
    }
  });

  it('without a requestId (future internal use): still persists and broadcasts, just does not reply with profile-result', async () => {
    const user = await makeUser('pu');
    const { socket, sent, participant } = joinNew(user);
    try {
      await handlers.profile(socket, { displayName: 'No Id' });
      const [row] = await db.select().from(users).where(eq(users.id, user.id));
      assert.equal(row!.displayName, 'No Id');
      assert.ok(!sent.some((e) => e.payload?.t === 'profile-result'));
    } finally {
      cleanupParticipant(participant);
    }
  });

  it('an image-only patch does not publish or overwrite the draft name/bio/links', async () => {
    const user = await makeUser('pu');
    const { socket, participant } = joinNew(user);
    try {
      const avatarUrl = await makeOwnedAvatarUpload(user.id);
      await handlers.profile(socket, { requestId: 'r3', displayName: 'Original', bio: 'original bio' });
      // a media-only patch — no displayName/bio/profileLinks key at all,
      // the way an avatar upload sends it (see useProfileUpdate.ts)
      await handlers.profile(socket, { requestId: 'r4', avatar: avatarUrl });

      const [row] = await db.select().from(users).where(eq(users.id, user.id));
      assert.equal(row!.avatar, avatarUrl);
      assert.equal(row!.displayName, 'Original', 'the image patch should not have touched the name');
      assert.equal(row!.bio, 'original bio', 'nor the bio');
    } finally {
      cleanupParticipant(participant);
    }
  });

  it('avatar/uploads/<id> not uploaded by that account is silently refused (comes back empty)', async () => {
    // the exact bug this fix closes: a client could set `avatar` to ANY
    // account's own /uploads/<id> (the id is a public, observable string) —
    // sanitizeAvatar only checked the FORMAT, not who actually uploaded it.
    const owner = await makeUser('pu');
    const attacker = await makeUser('pu');
    const { socket, participant } = joinNew(attacker);
    try {
      const someoneElsesAvatar = await makeOwnedAvatarUpload(owner.id);
      await handlers.profile(socket, { requestId: 'r7', avatar: someoneElsesAvatar });

      const [row] = await db.select().from(users).where(eq(users.id, attacker.id));
      assert.equal(row!.avatar, '', 'a reference that is not mine should become empty, not be accepted');
    } finally {
      cleanupParticipant(participant);
    }
  });

  it('an external URL (https://...) is still accepted normally — the check is only for /uploads/<id>', async () => {
    const user = await makeUser('pu');
    const { socket, participant } = joinNew(user);
    try {
      await handlers.profile(socket, { requestId: 'r8', avatar: 'https://exemplo.com/foto.png' });
      const [row] = await db.select().from(users).where(eq(users.id, user.id));
      assert.equal(row!.avatar, 'https://exemplo.com/foto.png');
    } finally {
      cleanupParticipant(participant);
    }
  });

  it('two edits from the same account in quick succession apply in order, without one erasing the other', async () => {
    const user = await makeUser('pu');
    const { socket, participant } = joinNew(user);
    try {
      // fired without awaiting the first — this is exactly the two-tabs-at-once
      // scenario the per-account queue (profileQueue.ts) exists for
      const first = handlers.profile(socket, { requestId: 'r5', displayName: 'First' });
      const second = handlers.profile(socket, { requestId: 'r6', bio: 'second edit' });
      await Promise.all([first, second]);

      const [row] = await db.select().from(users).where(eq(users.id, user.id));
      // both changes landed: the second patch (bio-only) didn't run against a
      // stale base that would have reverted displayName to its pre-'First' value
      assert.equal(row!.displayName, 'First');
      assert.equal(row!.bio, 'second edit');
      assert.equal(participant.displayName, 'First');
      assert.equal(participant.bio, 'second edit');
    } finally {
      cleanupParticipant(participant);
    }
  });

  it('one account does not interfere with another account\'s queue (patches from different accounts do not wait on each other)', async () => {
    const a = await makeUser('pu'); const b = await makeUser('pu');
    const A = joinNew(a); const B = joinNew(b);
    try {
      await Promise.all([
        handlers.profile(A.socket, { requestId: 'ra', displayName: 'Account A' }),
        handlers.profile(B.socket, { requestId: 'rb', displayName: 'Account B' }),
      ]);
      const [rowA] = await db.select().from(users).where(eq(users.id, a.id));
      const [rowB] = await db.select().from(users).where(eq(users.id, b.id));
      assert.equal(rowA!.displayName, 'Account A');
      assert.equal(rowB!.displayName, 'Account B');
    } finally {
      cleanupParticipant(A.participant); cleanupParticipant(B.participant);
    }
  });
});

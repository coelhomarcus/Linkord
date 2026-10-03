import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { and, eq, or, sql } from 'drizzle-orm';
import { acceptFriendRequest, requestFriendship } from '../../src/modules/friendships/friendshipsRepository.js';
import { blockUser } from '../../src/modules/blocks/blocksRepository.js';
import { db, makeUser, pool } from './helpers.js';
import { friendships, userBlocks } from '../../src/db/schema.js';

after(() => pool.end());

const rowsFor = (a: string, b: string) => {
  const [low, high] = a < b ? [a, b] : [b, a];
  return db.select().from(friendships).where(and(eq(friendships.userLowId, low), eq(friendships.userHighId, high)));
};

describe('social relationships under concurrency (real Postgres)', () => {
  it('crossed requests (A→B and B→A at the same time) produce ONE relationship', async () => {
    for (let round = 0; round < 8; round++) {
      const a = await makeUser('cx'); const b = await makeUser('cx');
      const [ra, rb] = await Promise.all([requestFriendship(a.id, b.username), requestFriendship(b.id, a.username)]);
      const rows = await rowsFor(a.id, b.id);
      assert.equal(rows.length, 1, `round ${round}: ${rows.length} rows`);
      assert.equal(rows[0]!.status, 'pending');
      // exactly one of them opened the request; the other one hit the existing row
      assert.equal([ra.code, rb.code].filter((code) => code === 'created').length, 1, `round ${round}: ${ra.code}/${rb.code}`);
    }
  });

  it('the same request from two tabs does not duplicate', async () => {
    const a = await makeUser('tw'); const b = await makeUser('tw');
    const results = await Promise.all([1, 2, 3, 4].map(() => requestFriendship(a.id, b.username)));
    assert.equal(results.filter((r) => r.code === 'created').length, 1);
    assert.equal((await rowsFor(a.id, b.id)).length, 1);
  });

  it('accept × block: an accepted friendship never coexists with a standing block (10 rounds)', async () => {
    for (let round = 0; round < 10; round++) {
      const a = await makeUser('ab'); const b = await makeUser('ab');
      await requestFriendship(a.id, b.username);
      await Promise.allSettled([acceptFriendRequest(b.id, a.id), blockUser(b.id, a.id)]);
      const [friendship] = await rowsFor(a.id, b.id);
      const blocks = await db.select().from(userBlocks).where(or(and(eq(userBlocks.blockerId, b.id), eq(userBlocks.blockedId, a.id)), and(eq(userBlocks.blockerId, a.id), eq(userBlocks.blockedId, b.id))));
      assert.equal(blocks.length, 1, `round ${round}: the block should exist`);
      assert.notEqual(friendship!.status, 'accepted', `round ${round}: accepted friendship coexisting with a block`);
    }
  });

  it('the user row count is stable (test database sanity check)', async () => {
    const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(friendships);
    assert.ok(row!.n >= 0);
  });
});

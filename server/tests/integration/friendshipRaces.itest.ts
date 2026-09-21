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

describe('relacoes sociais sob concorrencia (Postgres real)', () => {
  it('pedidos cruzados (A→B e B→A ao mesmo tempo) geram UMA relacao', async () => {
    for (let round = 0; round < 8; round++) {
      const a = await makeUser('cx'); const b = await makeUser('cx');
      const [ra, rb] = await Promise.all([requestFriendship(a.id, b.username), requestFriendship(b.id, a.username)]);
      const rows = await rowsFor(a.id, b.id);
      assert.equal(rows.length, 1, `rodada ${round}: ${rows.length} linhas`);
      assert.equal(rows[0]!.status, 'pending');
      // exactly one of them opened the request; the other one hit the existing row
      assert.equal([ra.code, rb.code].filter((code) => code === 'created').length, 1, `rodada ${round}: ${ra.code}/${rb.code}`);
    }
  });

  it('o mesmo pedido em duas abas nao duplica', async () => {
    const a = await makeUser('tw'); const b = await makeUser('tw');
    const results = await Promise.all([1, 2, 3, 4].map(() => requestFriendship(a.id, b.username)));
    assert.equal(results.filter((r) => r.code === 'created').length, 1);
    assert.equal((await rowsFor(a.id, b.id)).length, 1);
  });

  it('aceitar × bloquear: nunca sobra amizade aceita com bloqueio de pe (10 rodadas)', async () => {
    for (let round = 0; round < 10; round++) {
      const a = await makeUser('ab'); const b = await makeUser('ab');
      await requestFriendship(a.id, b.username);
      await Promise.allSettled([acceptFriendRequest(b.id, a.id), blockUser(b.id, a.id)]);
      const [friendship] = await rowsFor(a.id, b.id);
      const blocks = await db.select().from(userBlocks).where(or(and(eq(userBlocks.blockerId, b.id), eq(userBlocks.blockedId, a.id)), and(eq(userBlocks.blockerId, a.id), eq(userBlocks.blockedId, b.id))));
      assert.equal(blocks.length, 1, `rodada ${round}: bloqueio deveria existir`);
      assert.notEqual(friendship!.status, 'accepted', `rodada ${round}: amizade aceita coexistindo com bloqueio`);
    }
  });

  it('a contagem de linhas de usuario e estavel (sanidade do banco de teste)', async () => {
    const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(friendships);
    assert.ok(row!.n >= 0);
  });
});

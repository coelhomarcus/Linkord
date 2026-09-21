import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { config } from '../../src/config/env.js';
import { friendships, groupInvitations, users } from '../../src/db/schema.js';
import { createApp } from '../../src/http/app.js';
import { createSession } from '../../src/modules/auth/session.js';
import { listReceivedInvitations } from '../../src/modules/conversations/invitationsRepository.js';
import { listFriendRequests, listFriends } from '../../src/modules/friendships/friendshipsRepository.js';
import { SOCIAL_PAGE_SIZE } from '../../src/modules/friendships/cursor.js';
import { befriend, db, makeGroupWithMembers, makeUser, pool } from './helpers.js';

let app: FastifyInstance;
before(async () => { app = createApp(); await app.ready(); });
after(async () => { await app.close(); await pool.end(); });

const names = (page: Awaited<ReturnType<typeof listFriends>>) => {
  assert.ok(typeof page !== 'string');
  return page.items.map((i) => i.user.username);
};

async function pending(requester: string, other: string): Promise<void> {
  const [low, high] = requester < other ? [requester, other] : [other, requester];
  await db.insert(friendships).values({ id: crypto.randomUUID(), userLowId: low, userHighId: high, requestedBy: requester, status: 'pending' });
}

describe('amigos online: filtrado antes da paginacao (Postgres real)', () => {
  it('31 amigos, so o ultimo (fora da primeira pagina) online: aparece em Online', async () => {
    const me = await makeUser('on');
    const friends = [];
    for (let i = 0; i < SOCIAL_PAGE_SIZE + 1; i++) { const f = await makeUser('fr'); await befriend(me.id, f.id); friends.push(f); }
    friends.sort((a, b) => a.username.toLowerCase().localeCompare(b.username.toLowerCase()));
    const last = friends[friends.length - 1]!;

    const all = await listFriends(me.id, {});
    assert.ok(typeof all !== 'string');
    assert.equal(all.items.length, SOCIAL_PAGE_SIZE);
    assert.ok(all.nextCursor, 'a lista completa continua paginada');
    assert.ok(!names(all).includes(last.username), 'o ultimo esta na segunda pagina');

    const stranger = await makeUser('st'); // online, but not a friend
    const online = await listFriends(me.id, { onlineIds: [last.id, stranger.id] });
    assert.deepEqual(names(online), [last.username]);
    assert.equal((online as { nextCursor: string | null }).nextCursor, null);
  });

  it('ids online vazios: lista vazia; um conhecido de grupo que nao e amigo nunca aparece', async () => {
    const me = await makeUser('on'); const friend = await makeUser('fr'); const groupmate = await makeUser('gm');
    await befriend(me.id, friend.id);
    await makeGroupWithMembers(me.id, [groupmate.id]);
    assert.deepEqual(names(await listFriends(me.id, { onlineIds: [] })), []);
    assert.deepEqual(names(await listFriends(me.id, { onlineIds: [groupmate.id] })), []);
    assert.deepEqual(names(await listFriends(me.id, { onlineIds: [friend.id, groupmate.id] })), [friend.username]);
  });

  it('busca e online se combinam antes da paginacao', async () => {
    const me = await makeUser('on'); const a = await makeUser('alvo'); const b = await makeUser('outro');
    await befriend(me.id, a.id); await befriend(me.id, b.id);
    assert.deepEqual(names(await listFriends(me.id, { q: 'alvo', onlineIds: [a.id, b.id] })), [a.username]);
    assert.deepEqual(names(await listFriends(me.id, { q: 'alvo', onlineIds: [b.id] })), []);
  });
});

describe('busca em pedidos e convites (Postgres real)', () => {
  it('% e _ sao literais (nao coringas)', async () => {
    const me = await makeUser('sq'); const plain = await makeUser('pl'); const odd = await makeUser('od');
    await db.update(users).set({ displayName: '100%_real' }).where(eq(users.id, odd.id));
    await befriend(me.id, plain.id); await befriend(me.id, odd.id);
    // usernames here already contain '_', so probe with sequences that only match literally
    assert.deepEqual(names(await listFriends(me.id, { q: '0%_r' })), [odd.username]);
    // as wildcards these would match '100%_real' ('1' … 'r'; '10' + any char + 'real'), literally they don't
    assert.deepEqual(names(await listFriends(me.id, { q: '1%r' })), []);
    assert.deepEqual(names(await listFriends(me.id, { q: '10_real' })), []);
    assert.deepEqual(names(await listFriends(me.id, { q: '\\' })), []);
  });

  it('pedidos: a busca vale para recebidos e enviados, sem cruzar as direcoes', async () => {
    const me = await makeUser('rq'); const inc = await makeUser('ana'); const out = await makeUser('bia'); const other = await makeUser('ana');
    await pending(inc.id, me.id); await pending(me.id, out.id); await pending(other.id, me.id);
    const incoming = await listFriendRequests(me.id, 'incoming', undefined, 'ana');
    assert.ok(typeof incoming !== 'string');
    assert.equal(incoming.items.length, 2);
    const outgoing = await listFriendRequests(me.id, 'outgoing', undefined, 'bia');
    assert.ok(typeof outgoing !== 'string');
    assert.deepEqual(outgoing.items.map((i) => i.user.username), [out.username]);
    const none = await listFriendRequests(me.id, 'incoming', undefined, 'bia');
    assert.ok(typeof none !== 'string');
    assert.equal(none.items.length, 0);
  });

  it('convites: casa pelo nome do grupo ou pelo remetente, so entre os proprios', async () => {
    const owner = await makeUser('ow'); const guest = await makeUser('gu'); const other = await makeUser('ot');
    await befriend(owner.id, guest.id);
    const groupId = await makeGroupWithMembers(owner.id, [], 'Turma do Futebol');
    await db.insert(groupInvitations).values({ id: crypto.randomUUID(), conversationId: groupId, inviterId: owner.id, inviteeId: guest.id });
    const byTitle = await listReceivedInvitations(guest.id, undefined, 'futebol');
    assert.ok(typeof byTitle !== 'string');
    assert.equal(byTitle.items.length, 1);
    const byInviter = await listReceivedInvitations(guest.id, undefined, owner.username.toLowerCase());
    assert.ok(typeof byInviter !== 'string');
    assert.equal(byInviter.items.length, 1);
    const miss = await listReceivedInvitations(guest.id, undefined, 'xadrez');
    assert.ok(typeof miss !== 'string');
    assert.equal(miss.items.length, 0);
    const notMine = await listReceivedInvitations(other.id, undefined, 'futebol');
    assert.ok(typeof notMine !== 'string');
    assert.equal(notMine.items.length, 0);
  });
});

describe('/api/friends?status=online (HTTP)', () => {
  it('valida o filtro e exige sessao', async () => {
    const me = await makeUser('ht');
    const token = (await createSession(me.id)).rawToken;
    const headers = { cookie: `${config.SESSION_COOKIE}=${token}` };
    assert.equal((await app.inject({ method: 'GET', url: '/api/friends?status=online' })).statusCode, 401);
    assert.equal((await app.inject({ method: 'GET', url: '/api/friends?status=online', headers })).statusCode, 200);
    const bad = await app.inject({ method: 'GET', url: '/api/friends?status=todos', headers });
    assert.equal(bad.statusCode, 400);
    assert.equal(JSON.parse(bad.body).error.code, 'invalid_request');
  });
});

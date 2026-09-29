import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { config } from '../../src/config/env.js';
import { conversationMembers, friendships, userBlocks, users } from '../../src/db/schema.js';
import { createApp } from '../../src/http/app.js';
import { createSession } from '../../src/modules/auth/session.js';
import { canSendDirectMessage } from '../../src/modules/friendships/friendshipsRepository.js';
import { createInvitations } from '../../src/modules/conversations/invitationsRepository.js';
import { befriend, db, makeGroupWithMembers, makeUser, pool } from './helpers.js';

// The permission matrix of docs/contratos.md, executed over HTTP against a real
// database: for each action, who may do it and, for everyone else, WHICH error
// they get. Actions that only exist as socket handlers (group-update,
// group-delete, chat-*, call-kick) are not reachable from here.

let app: FastifyInstance;
before(async () => { app = createApp(); await app.ready(); });
after(async () => { await app.close(); await pool.end(); });

interface Actor { id: string; username: string; token: string }
async function actor(prefix: string, role: 'user' | 'admin' = 'user'): Promise<Actor> {
  const user = await makeUser(prefix, role);
  return { ...user, token: (await createSession(user.id)).rawToken };
}

interface Reply { status: number; code?: string; body: any }
async function call(as: Actor | null, method: 'GET' | 'POST' | 'DELETE', url: string, payload?: unknown): Promise<Reply> {
  const res = await app.inject({ method, url, payload: payload as object | undefined, headers: as ? { cookie: `${config.SESSION_COOKIE}=${as.token}` } : {} });
  const body = res.body ? JSON.parse(res.body) : null;
  return { status: res.statusCode, code: body?.error?.code, body };
}

function expectDenied(reply: Reply, status: number, code: string, who: string): void {
  assert.deepEqual({ status: reply.status, code: reply.code }, { status, code }, `${who}: expected ${status} ${code}`);
}

/** owner + member + ex-member in one group; a friend, an invited friend, a
 * stranger and someone the owner blocked around it. */
async function world() {
  const [owner, member, exMember, friend, invitee, stranger, blocked] = await Promise.all(
    ['own', 'mem', 'exm', 'fri', 'inv', 'str', 'blk'].map((p) => actor(p)),
  ) as [Actor, Actor, Actor, Actor, Actor, Actor, Actor];
  for (const other of [member, exMember, friend, invitee, blocked]) await befriend(owner.id, other.id);
  const groupId = await makeGroupWithMembers(owner.id, [member.id, exMember.id], 'matrix');
  await db.delete(conversationMembers).where(eq(conversationMembers.userId, exMember.id));
  const invited = await createInvitations(owner.id, groupId, [invitee.id]);
  assert.ok('results' in invited);
  const invitationId = invited.results[0]!.invitationId!;
  await db.insert(userBlocks).values({ blockerId: owner.id, blockedId: blocked.id });
  return { owner, member, exMember, friend, invitee, stranger, blocked, groupId, invitationId };
}

describe('matrix: admin routes', () => {
  const routes: [string, 'GET' | 'POST' | 'DELETE', string][] = [
    ['list users', 'GET', '/api/admin/users'],
    ['user detail', 'GET', '/api/admin/users/x'],
    ['suspend user', 'POST', '/api/admin/users/x/suspend'],
    ['reactivate user', 'POST', '/api/admin/users/x/reactivate'],
    ['revoke sessions', 'POST', '/api/admin/users/x/revoke-sessions'],
    ['grant admin', 'POST', '/api/admin/users/x/grant-admin'],
    ['remove admin', 'POST', '/api/admin/users/x/revoke-admin'],
    ['delete user', 'DELETE', '/api/admin/users/x'],
    ['list groups', 'GET', '/api/admin/groups'],
    ['group detail', 'GET', '/api/admin/groups/x'],
    ['suspend group', 'POST', '/api/admin/groups/x/suspend'],
    ['reactivate group', 'POST', '/api/admin/groups/x/reactivate'],
    ['assign owner', 'POST', '/api/admin/groups/x/owner'],
    ['delete group', 'DELETE', '/api/admin/groups/x'],
    ['list reports', 'GET', '/api/admin/reports'],
    ['report detail', 'GET', '/api/admin/reports/x'],
    ['claim report', 'POST', '/api/admin/reports/x/claim'],
    ['resolve report', 'POST', '/api/admin/reports/x/resolve'],
    ['System tab', 'GET', '/api/admin/system'],
    ['sweep orphans', 'POST', '/api/admin/system/sweep-orphans'],
    ['audit', 'GET', '/api/admin/audit'],
  ];
  const body = { reason: 'valid reason for the test', dryRun: true };

  it('no session: 401; a plain user, a demoted admin and a suspended one never reach the action', async () => {
    const plain = await actor('pl');
    const demoted = await actor('dm', 'admin');
    await db.update(users).set({ role: 'user' }).where(eq(users.id, demoted.id)); // session still carries role=admin
    const suspended = await actor('sp', 'admin');
    await db.update(users).set({ status: 'suspended' }).where(eq(users.id, suspended.id));

    for (const [name, method, url] of routes) {
      expectDenied(await call(null, method, url, method === 'GET' ? undefined : body), 401, 'unauthenticated', `${name} no session`);
      expectDenied(await call(plain, method, url, method === 'GET' ? undefined : body), 403, 'forbidden', `${name} plain user`);
      expectDenied(await call(demoted, method, url, method === 'GET' ? undefined : body), 403, 'forbidden', `${name} demoted admin`);
      expectDenied(await call(suspended, method, url, method === 'GET' ? undefined : body), 401, 'unauthenticated', `${name} suspended admin`);
    }
  });

  it('an active admin reads; without a reason it does not act; it does not act on itself', async () => {
    const admin = await actor('ad', 'admin');
    for (const url of ['/api/admin/users', '/api/admin/groups', '/api/admin/reports', '/api/admin/system', '/api/admin/audit']) {
      assert.equal((await call(admin, 'GET', url)).status, 200, url);
    }
    expectDenied(await call(admin, 'POST', `/api/admin/users/${admin.id}/suspend`, {}), 400, 'reason_required', 'no reason');
    expectDenied(await call(admin, 'POST', `/api/admin/users/${admin.id}/suspend`, body), 409, 'self_action', 'self-suspension');
    expectDenied(await call(admin, 'POST', `/api/admin/users/${admin.id}/revoke-admin`, body), 409, 'self_action', 'self-demotion');
  });
});

describe('matrix: groups and invitations', () => {
  it('inviting: only the current owner, only a friend, never someone blocked or already a member', async () => {
    const w = await world();
    const url = `/api/groups/${w.groupId}/invitations`;
    expectDenied(await call(null, 'POST', url, { userIds: [w.friend.id] }), 401, 'unauthenticated', 'no session');
    for (const [who, a] of [['member', w.member], ['ex-member', w.exMember], ['invitee', w.invitee], ['friend', w.friend], ['stranger', w.stranger]] as const) {
      expectDenied(await call(a, 'POST', url, { userIds: [w.friend.id] }), 403, 'forbidden', who);
    }
    const res = await call(w.owner, 'POST', url, { userIds: [w.friend.id, w.stranger.id, w.blocked.id, w.member.id] });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.results.map((r: { outcome: string }) => r.outcome), ['sent', 'not_friends', 'not_friends', 'already_member']);
  });

  it('sent invitations: only the owner lists them', async () => {
    const w = await world();
    const url = `/api/groups/${w.groupId}/invitations`;
    assert.equal((await call(w.owner, 'GET', url)).status, 200);
    for (const [who, a] of [['member', w.member], ['ex-member', w.exMember], ['invitee', w.invitee], ['friend', w.friend], ['stranger', w.stranger]] as const) {
      expectDenied(await call(a, 'GET', url), 403, 'forbidden', who);
    }
  });

  it('received invitations: each account sees only its own', async () => {
    const w = await world();
    assert.equal((await call(w.invitee, 'GET', '/api/group-invitations')).body.items.length, 1);
    assert.equal((await call(w.stranger, 'GET', '/api/group-invitations')).body.items.length, 0);
    assert.equal((await call(w.owner, 'GET', '/api/group-invitations')).body.items.length, 0);
  });

  it('accepting and declining: only the invitee (no one else even knows it exists)', async () => {
    const w = await world();
    for (const action of ['accept', 'decline']) {
      for (const [who, a] of [['owner', w.owner], ['stranger', w.stranger], ['member', w.member], ['ex-member', w.exMember], ['friend', w.friend]] as const) {
        expectDenied(await call(a, 'POST', `/api/group-invitations/${w.invitationId}/${action}`), 404, 'not_found', `${action} ${who}`);
      }
    }
    expectDenied(await call(null, 'POST', `/api/group-invitations/${w.invitationId}/accept`), 401, 'unauthenticated', 'no session');
    const ok = await call(w.invitee, 'POST', `/api/group-invitations/${w.invitationId}/accept`);
    assert.equal(ok.status, 200);
    assert.equal(ok.body.invitation.status, 'accepted');
  });

  it('revoking: only the group owner; invitee, member and stranger get 403', async () => {
    const w = await world();
    const url = `/api/group-invitations/${w.invitationId}`;
    for (const [who, a] of [['invitee', w.invitee], ['member', w.member], ['ex-member', w.exMember], ['friend', w.friend], ['stranger', w.stranger]] as const) {
      expectDenied(await call(a, 'DELETE', url), 403, 'forbidden', who);
    }
    const ok = await call(w.owner, 'DELETE', url);
    assert.equal(ok.status, 200);
    assert.equal(ok.body.invitation.status, 'revoked');
    // and a revoked invitation can no longer be accepted
    expectDenied(await call(w.invitee, 'POST', `/api/group-invitations/${w.invitationId}/accept`), 409, 'conflict', 'accepting a revoked one');
  });

  it('member list: only members; ex-member, pending invitee and stranger get 404', async () => {
    const w = await world();
    const url = `/api/groups/${w.groupId}/members`;
    expectDenied(await call(null, 'GET', url), 401, 'unauthenticated', 'no session');
    for (const [who, a] of [['owner', w.owner], ['member', w.member]] as const) assert.equal((await call(a, 'GET', url)).status, 200, who);
    for (const [who, a] of [['ex-member', w.exMember], ['invitee', w.invitee], ['friend', w.friend], ['stranger', w.stranger]] as const) {
      expectDenied(await call(a, 'GET', url), 404, 'not_found', who);
    }
  });

  it('creating a group with an invite only reaches friends', async () => {
    const w = await world();
    const res = await call(w.owner, 'POST', '/api/groups', { title: 'new', inviteeIds: [w.friend.id, w.stranger.id] });
    assert.equal(res.status, 201);
    assert.deepEqual(res.body.results.map((r: { outcome: string }) => r.outcome), ['sent', 'not_friends']);
  });
});

describe('matrix: friendship, blocking and direct messages', () => {
  it('a request to someone who blocked (or was blocked) is indistinguishable from a nonexistent account', async () => {
    const a = await actor('a'); const b = await actor('b');
    await db.insert(userBlocks).values({ blockerId: b.id, blockedId: a.id });
    expectDenied(await call(a, 'POST', '/api/friend-requests', { username: b.username }), 404, 'user_unavailable', 'blocked account requests');
    expectDenied(await call(b, 'POST', '/api/friend-requests', { username: a.username }), 404, 'user_unavailable', 'blocker requests');
    expectDenied(await call(a, 'POST', '/api/friend-requests', { username: 'nobody_' + crypto.randomUUID().slice(0, 8) }), 404, 'user_unavailable', 'nonexistent');
  });

  it('accepting/declining: only the request recipient', async () => {
    const a = await actor('a'); const b = await actor('b'); const c = await actor('c');
    assert.equal((await call(a, 'POST', '/api/friend-requests', { username: b.username })).status, 201);
    // the requester cannot accept their own request (403); a third account has no request to act on (404)
    expectDenied(await call(a, 'POST', `/api/friend-requests/${b.id}/accept`), 403, 'forbidden', 'requester accepts own request');
    expectDenied(await call(c, 'POST', `/api/friend-requests/${a.id}/accept`), 404, 'not_found', 'third party accepts');
    expectDenied(await call(c, 'POST', `/api/friend-requests/${a.id}/decline`), 404, 'not_found', 'third party declines');
    // only the requester cancels; the recipient is a party to it (403), a third account has nothing to cancel (404)
    expectDenied(await call(b, 'POST', `/api/friend-requests/${a.id}/cancel`), 403, 'forbidden', 'recipient cancels');
    expectDenied(await call(c, 'POST', `/api/friend-requests/${a.id}/cancel`), 404, 'not_found', 'third party cancels');
    assert.equal((await call(b, 'POST', `/api/friend-requests/${a.id}/accept`)).status, 200);
  });

  it('canSendDirectMessage: friends yes; strangers, blocking in either direction and ex-friends no', async () => {
    const a = await makeUser('dm'); const b = await makeUser('dm'); const c = await makeUser('dm'); const d = await makeUser('dm');
    await befriend(a.id, b.id); await befriend(a.id, c.id); await befriend(a.id, d.id);
    assert.equal(await canSendDirectMessage(a.id, b.id), true);
    assert.equal(await canSendDirectMessage(a.id, (await makeUser('dm')).id), false, 'stranger');
    await db.insert(userBlocks).values({ blockerId: a.id, blockedId: c.id });
    assert.equal(await canSendDirectMessage(a.id, c.id), false, 'a blocked c');
    assert.equal(await canSendDirectMessage(c.id, a.id), false, 'c was blocked by a');
    await db.update(friendships).set({ status: 'removed' }).where(eq(friendships.userLowId, a.id < d.id ? a.id : d.id));
    assert.equal(await canSendDirectMessage(a.id, d.id), false, 'ex-friend');
  });
});

describe('matrix: notifications and reports', () => {
  it('notifications: only the recipient marks; the other account marks 0', async () => {
    const w = await world();
    const mine = (await call(w.invitee, 'GET', '/api/notifications')).body.items as { id: string }[];
    assert.ok(mine.length >= 1);
    assert.equal((await call(w.stranger, 'GET', '/api/notifications')).body.items.length, 0);
    assert.equal((await call(w.stranger, 'POST', '/api/notifications/read', { ids: mine.map((n) => n.id) })).body.marked, 0);
    assert.equal((await call(w.invitee, 'POST', '/api/notifications/read', { ids: mine.map((n) => n.id) })).body.marked, mine.length);
    // dismissing follows the same rule: someone else's request deletes nothing
    assert.equal((await call(w.stranger, 'DELETE', `/api/notifications/${mine[0]!.id}`)).body.deleted, 0);
    assert.equal((await call(w.stranger, 'DELETE', '/api/notifications')).body.deleted, 0);
    assert.equal((await call(w.invitee, 'GET', '/api/notifications')).body.items.length, mine.length);
    assert.equal((await call(w.invitee, 'DELETE', `/api/notifications/${mine[0]!.id}`)).body.deleted, 1);
    assert.equal((await call(w.invitee, 'DELETE', '/api/notifications')).body.deleted, mine.length - 1);
    assert.equal((await call(w.invitee, 'GET', '/api/notifications')).body.items.length, 0);
    expectDenied(await call(null, 'DELETE', '/api/notifications'), 401, 'unauthenticated', 'clearing with no session');
    expectDenied(await call(null, 'GET', '/api/notifications'), 401, 'unauthenticated', 'no session');
  });

  it('reporting: only what the account can see; an invisible target and a nonexistent one answer the same', async () => {
    const w = await world();
    const report = (a: Actor | null, targetType: string, targetId: string) => call(a, 'POST', '/api/reports', { targetType, targetId, category: 'spam', details: '' });
    assert.equal((await report(w.member, 'group', w.groupId)).status, 201);
    for (const [who, a] of [['ex-member', w.exMember], ['invitee', w.invitee], ['friend', w.friend], ['stranger', w.stranger]] as const) {
      expectDenied(await report(a, 'group', w.groupId), 404, 'not_found', `group it can't see: ${who}`);
    }
    expectDenied(await report(w.stranger, 'group', 'nonexistent'), 404, 'not_found', 'nonexistent group');
    expectDenied(await report(w.stranger, 'user', w.owner.id), 404, 'not_found', 'unrelated user');
    assert.equal((await report(w.friend, 'user', w.owner.id)).status, 201);
    expectDenied(await report(w.friend, 'user', w.friend.id), 400, 'invalid_report', 'against oneself');
    expectDenied(await report(null, 'group', w.groupId), 401, 'unauthenticated', 'no session');
  });
});

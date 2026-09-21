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
  assert.deepEqual({ status: reply.status, code: reply.code }, { status, code }, `${who}: esperava ${status} ${code}`);
}

/** owner + member + ex-member in one group; a friend, an invited friend, a
 * stranger and someone the owner blocked around it. */
async function world() {
  const [owner, member, exMember, friend, invitee, stranger, blocked] = await Promise.all(
    ['own', 'mem', 'exm', 'fri', 'inv', 'str', 'blk'].map((p) => actor(p)),
  ) as [Actor, Actor, Actor, Actor, Actor, Actor, Actor];
  for (const other of [member, exMember, friend, invitee, blocked]) await befriend(owner.id, other.id);
  const groupId = await makeGroupWithMembers(owner.id, [member.id, exMember.id], 'matriz');
  await db.delete(conversationMembers).where(eq(conversationMembers.userId, exMember.id));
  const invited = await createInvitations(owner.id, groupId, [invitee.id]);
  assert.ok('results' in invited);
  const invitationId = invited.results[0]!.invitationId!;
  await db.insert(userBlocks).values({ blockerId: owner.id, blockedId: blocked.id });
  return { owner, member, exMember, friend, invitee, stranger, blocked, groupId, invitationId };
}

describe('matriz: rotas de administracao', () => {
  const routes: [string, 'GET' | 'POST' | 'DELETE', string][] = [
    ['listar usuarios', 'GET', '/api/admin/users'],
    ['detalhe do usuario', 'GET', '/api/admin/users/x'],
    ['suspender usuario', 'POST', '/api/admin/users/x/suspend'],
    ['reativar usuario', 'POST', '/api/admin/users/x/reactivate'],
    ['revogar sessoes', 'POST', '/api/admin/users/x/revoke-sessions'],
    ['conceder admin', 'POST', '/api/admin/users/x/grant-admin'],
    ['remover admin', 'POST', '/api/admin/users/x/revoke-admin'],
    ['excluir usuario', 'DELETE', '/api/admin/users/x'],
    ['listar grupos', 'GET', '/api/admin/groups'],
    ['detalhe do grupo', 'GET', '/api/admin/groups/x'],
    ['suspender grupo', 'POST', '/api/admin/groups/x/suspend'],
    ['reativar grupo', 'POST', '/api/admin/groups/x/reactivate'],
    ['atribuir dono', 'POST', '/api/admin/groups/x/owner'],
    ['excluir grupo', 'DELETE', '/api/admin/groups/x'],
    ['listar denuncias', 'GET', '/api/admin/reports'],
    ['detalhe da denuncia', 'GET', '/api/admin/reports/x'],
    ['assumir denuncia', 'POST', '/api/admin/reports/x/claim'],
    ['resolver denuncia', 'POST', '/api/admin/reports/x/resolve'],
    ['aba Sistema', 'GET', '/api/admin/system'],
    ['varrer orfaos', 'POST', '/api/admin/system/sweep-orphans'],
    ['auditoria', 'GET', '/api/admin/audit'],
  ];
  const body = { reason: 'motivo valido para o teste', dryRun: true };

  it('sem sessao: 401; usuario comum, admin rebaixado e suspenso nunca chegam a acao', async () => {
    const plain = await actor('pl');
    const demoted = await actor('dm', 'admin');
    await db.update(users).set({ role: 'user' }).where(eq(users.id, demoted.id)); // session still carries role=admin
    const suspended = await actor('sp', 'admin');
    await db.update(users).set({ status: 'suspended' }).where(eq(users.id, suspended.id));

    for (const [name, method, url] of routes) {
      expectDenied(await call(null, method, url, method === 'GET' ? undefined : body), 401, 'unauthenticated', `${name} sem sessao`);
      expectDenied(await call(plain, method, url, method === 'GET' ? undefined : body), 403, 'forbidden', `${name} usuario comum`);
      expectDenied(await call(demoted, method, url, method === 'GET' ? undefined : body), 403, 'forbidden', `${name} admin rebaixado`);
      expectDenied(await call(suspended, method, url, method === 'GET' ? undefined : body), 401, 'unauthenticated', `${name} admin suspenso`);
    }
  });

  it('admin ativo le; sem motivo nao age; nao age sobre si mesmo', async () => {
    const admin = await actor('ad', 'admin');
    for (const url of ['/api/admin/users', '/api/admin/groups', '/api/admin/reports', '/api/admin/system', '/api/admin/audit']) {
      assert.equal((await call(admin, 'GET', url)).status, 200, url);
    }
    expectDenied(await call(admin, 'POST', `/api/admin/users/${admin.id}/suspend`, {}), 400, 'reason_required', 'sem motivo');
    expectDenied(await call(admin, 'POST', `/api/admin/users/${admin.id}/suspend`, body), 409, 'self_action', 'auto-suspensao');
    expectDenied(await call(admin, 'POST', `/api/admin/users/${admin.id}/revoke-admin`, body), 409, 'self_action', 'auto-rebaixamento');
  });
});

describe('matriz: grupos e convites', () => {
  it('convidar: so o dono atual, so amigo, nunca bloqueado nem quem ja e membro', async () => {
    const w = await world();
    const url = `/api/groups/${w.groupId}/invitations`;
    expectDenied(await call(null, 'POST', url, { userIds: [w.friend.id] }), 401, 'unauthenticated', 'sem sessao');
    for (const [who, a] of [['membro', w.member], ['ex-membro', w.exMember], ['convidado', w.invitee], ['amigo', w.friend], ['estranho', w.stranger]] as const) {
      expectDenied(await call(a, 'POST', url, { userIds: [w.friend.id] }), 403, 'forbidden', who);
    }
    const res = await call(w.owner, 'POST', url, { userIds: [w.friend.id, w.stranger.id, w.blocked.id, w.member.id] });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.results.map((r: { outcome: string }) => r.outcome), ['sent', 'not_friends', 'not_friends', 'already_member']);
  });

  it('convites enviados: so o dono lista', async () => {
    const w = await world();
    const url = `/api/groups/${w.groupId}/invitations`;
    assert.equal((await call(w.owner, 'GET', url)).status, 200);
    for (const [who, a] of [['membro', w.member], ['ex-membro', w.exMember], ['convidado', w.invitee], ['amigo', w.friend], ['estranho', w.stranger]] as const) {
      expectDenied(await call(a, 'GET', url), 403, 'forbidden', who);
    }
  });

  it('convites recebidos: cada conta ve so os seus', async () => {
    const w = await world();
    assert.equal((await call(w.invitee, 'GET', '/api/group-invitations')).body.items.length, 1);
    assert.equal((await call(w.stranger, 'GET', '/api/group-invitations')).body.items.length, 0);
    assert.equal((await call(w.owner, 'GET', '/api/group-invitations')).body.items.length, 0);
  });

  it('aceitar e recusar: so o convidado (os demais nem sabem que existe)', async () => {
    const w = await world();
    for (const action of ['accept', 'decline']) {
      for (const [who, a] of [['dono', w.owner], ['estranho', w.stranger], ['membro', w.member], ['ex-membro', w.exMember], ['amigo', w.friend]] as const) {
        expectDenied(await call(a, 'POST', `/api/group-invitations/${w.invitationId}/${action}`), 404, 'not_found', `${action} ${who}`);
      }
    }
    expectDenied(await call(null, 'POST', `/api/group-invitations/${w.invitationId}/accept`), 401, 'unauthenticated', 'sem sessao');
    const ok = await call(w.invitee, 'POST', `/api/group-invitations/${w.invitationId}/accept`);
    assert.equal(ok.status, 200);
    assert.equal(ok.body.invitation.status, 'accepted');
  });

  it('revogar: so o dono do grupo; convidado, membro e estranho levam 403', async () => {
    const w = await world();
    const url = `/api/group-invitations/${w.invitationId}`;
    for (const [who, a] of [['convidado', w.invitee], ['membro', w.member], ['ex-membro', w.exMember], ['amigo', w.friend], ['estranho', w.stranger]] as const) {
      expectDenied(await call(a, 'DELETE', url), 403, 'forbidden', who);
    }
    const ok = await call(w.owner, 'DELETE', url);
    assert.equal(ok.status, 200);
    assert.equal(ok.body.invitation.status, 'revoked');
    // and a revoked invitation can no longer be accepted
    expectDenied(await call(w.invitee, 'POST', `/api/group-invitations/${w.invitationId}/accept`), 409, 'conflict', 'aceitar revogado');
  });

  it('lista de membros: so membros; ex-membro, convidado pendente e estranho recebem 404', async () => {
    const w = await world();
    const url = `/api/groups/${w.groupId}/members`;
    expectDenied(await call(null, 'GET', url), 401, 'unauthenticated', 'sem sessao');
    for (const [who, a] of [['dono', w.owner], ['membro', w.member]] as const) assert.equal((await call(a, 'GET', url)).status, 200, who);
    for (const [who, a] of [['ex-membro', w.exMember], ['convidado', w.invitee], ['amigo', w.friend], ['estranho', w.stranger]] as const) {
      expectDenied(await call(a, 'GET', url), 404, 'not_found', who);
    }
  });

  it('criar grupo com convite so alcanca amigos', async () => {
    const w = await world();
    const res = await call(w.owner, 'POST', '/api/groups', { title: 'novo', inviteeIds: [w.friend.id, w.stranger.id] });
    assert.equal(res.status, 201);
    assert.deepEqual(res.body.results.map((r: { outcome: string }) => r.outcome), ['sent', 'not_friends']);
  });
});

describe('matriz: amizade, bloqueio e mensagem direta', () => {
  it('pedido para quem bloqueou (ou foi bloqueado) e indistinguivel de conta inexistente', async () => {
    const a = await actor('a'); const b = await actor('b');
    await db.insert(userBlocks).values({ blockerId: b.id, blockedId: a.id });
    expectDenied(await call(a, 'POST', '/api/friend-requests', { username: b.username }), 404, 'user_unavailable', 'bloqueado pede');
    expectDenied(await call(b, 'POST', '/api/friend-requests', { username: a.username }), 404, 'user_unavailable', 'quem bloqueou pede');
    expectDenied(await call(a, 'POST', '/api/friend-requests', { username: 'ninguem_' + crypto.randomUUID().slice(0, 8) }), 404, 'user_unavailable', 'inexistente');
  });

  it('aceitar/recusar: so o destinatario do pedido', async () => {
    const a = await actor('a'); const b = await actor('b'); const c = await actor('c');
    assert.equal((await call(a, 'POST', '/api/friend-requests', { username: b.username })).status, 201);
    // the requester cannot accept their own request (403); a third account has no request to act on (404)
    expectDenied(await call(a, 'POST', `/api/friend-requests/${b.id}/accept`), 403, 'forbidden', 'remetente aceita o proprio pedido');
    expectDenied(await call(c, 'POST', `/api/friend-requests/${a.id}/accept`), 404, 'not_found', 'terceiro aceita');
    expectDenied(await call(c, 'POST', `/api/friend-requests/${a.id}/decline`), 404, 'not_found', 'terceiro recusa');
    // only the requester cancels; the recipient is a party to it (403), a third account has nothing to cancel (404)
    expectDenied(await call(b, 'POST', `/api/friend-requests/${a.id}/cancel`), 403, 'forbidden', 'destinatario cancela');
    expectDenied(await call(c, 'POST', `/api/friend-requests/${a.id}/cancel`), 404, 'not_found', 'terceiro cancela');
    assert.equal((await call(b, 'POST', `/api/friend-requests/${a.id}/accept`)).status, 200);
  });

  it('canSendDirectMessage: amigos sim; estranhos, bloqueio nos dois sentidos e ex-amigos nao', async () => {
    const a = await makeUser('dm'); const b = await makeUser('dm'); const c = await makeUser('dm'); const d = await makeUser('dm');
    await befriend(a.id, b.id); await befriend(a.id, c.id); await befriend(a.id, d.id);
    assert.equal(await canSendDirectMessage(a.id, b.id), true);
    assert.equal(await canSendDirectMessage(a.id, (await makeUser('dm')).id), false, 'estranho');
    await db.insert(userBlocks).values({ blockerId: a.id, blockedId: c.id });
    assert.equal(await canSendDirectMessage(a.id, c.id), false, 'a bloqueou c');
    assert.equal(await canSendDirectMessage(c.id, a.id), false, 'c foi bloqueado por a');
    await db.update(friendships).set({ status: 'removed' }).where(eq(friendships.userLowId, a.id < d.id ? a.id : d.id));
    assert.equal(await canSendDirectMessage(a.id, d.id), false, 'ex-amigo');
  });
});

describe('matriz: notificacoes e denuncias', () => {
  it('notificacoes: so o destinatario marca; a outra conta marca 0', async () => {
    const w = await world();
    const mine = (await call(w.invitee, 'GET', '/api/notifications')).body.items as { id: string }[];
    assert.ok(mine.length >= 1);
    assert.equal((await call(w.stranger, 'GET', '/api/notifications')).body.items.length, 0);
    assert.equal((await call(w.stranger, 'POST', '/api/notifications/read', { ids: mine.map((n) => n.id) })).body.marked, 0);
    assert.equal((await call(w.invitee, 'POST', '/api/notifications/read', { ids: mine.map((n) => n.id) })).body.marked, mine.length);
    expectDenied(await call(null, 'GET', '/api/notifications'), 401, 'unauthenticated', 'sem sessao');
  });

  it('denunciar: so o que a conta enxerga; alvo invisivel e inexistente respondem igual', async () => {
    const w = await world();
    const report = (a: Actor | null, targetType: string, targetId: string) => call(a, 'POST', '/api/reports', { targetType, targetId, category: 'spam', details: '' });
    assert.equal((await report(w.member, 'group', w.groupId)).status, 201);
    for (const [who, a] of [['ex-membro', w.exMember], ['convidado', w.invitee], ['amigo', w.friend], ['estranho', w.stranger]] as const) {
      expectDenied(await report(a, 'group', w.groupId), 404, 'not_found', `grupo que nao enxerga: ${who}`);
    }
    expectDenied(await report(w.stranger, 'group', 'inexistente'), 404, 'not_found', 'grupo inexistente');
    expectDenied(await report(w.stranger, 'user', w.owner.id), 404, 'not_found', 'usuario sem relacao');
    assert.equal((await report(w.friend, 'user', w.owner.id)).status, 201);
    expectDenied(await report(w.friend, 'user', w.friend.id), 400, 'invalid_report', 'a si mesmo');
    expectDenied(await report(null, 'group', w.groupId), 401, 'unauthenticated', 'sem sessao');
  });
});

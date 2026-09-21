import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { config } from '../../src/config/env.js';
import { removeMember, transferOwnership } from '../../src/modules/conversations/groupMembership.js';
import { acceptInvitation, createInvitations, declineInvitation, revokeInvitationForDeletedCard } from '../../src/modules/conversations/invitationsRepository.js';
import { deleteUserAccount } from '../../src/modules/admin/adminUsers.js';
import { getOrCreateDirect } from '../../src/modules/conversations/conversationsRepository.js';
import { befriend, db, makeGroupWithMembers, makeUser, memberCount, ownersOf, pool } from './helpers.js';
import { adminAuditLogs, conversations, conversationMembers, groupInvitations } from '../../src/db/schema.js';
import { and, eq, sql } from 'drizzle-orm';

after(() => pool.end());

describe('invariantes de grupo sob concorrencia (Postgres real)', () => {
  it('transferir × remover × sair: nunca um grupo com membros e sem dono, nunca dois donos (15 rodadas)', async () => {
    for (let round = 0; round < 15; round++) {
      const a = await makeUser('o'); const b = await makeUser('m'); const c = await makeUser('m');
      const g = await makeGroupWithMembers(a.id, [b.id, c.id]);
      const ops = [
        () => transferOwnership(g, a.id, b.id),
        () => removeMember(g, a.id, b.id),
        () => removeMember(g, a.id, a.id),
        () => removeMember(g, b.id, b.id),
      ];
      await Promise.allSettled((round % 2 ? ops : [...ops].reverse()).map((op) => op()));
      const owners = await ownersOf(g);
      const members = await memberCount(g);
      assert.ok(owners.length <= 1, `rodada ${round}: ${owners.length} donos`);
      if (members > 0) assert.equal(owners.length, 1, `rodada ${round}: ${members} membros e ${owners.length} donos`);
    }
  });

  it('DM e idempotente: 12 criacoes simultaneas do mesmo par dao UMA conversa', async () => {
    const a = await makeUser('dm'); const b = await makeUser('dm');
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => getOrCreateDirect(i % 2 ? a.id : b.id, i % 2 ? b.id : a.id, a.id)));
    assert.equal(new Set(results.map((r) => r.conversation.id)).size, 1);
    assert.equal(results.filter((r) => r.created).length, 1);
    assert.equal(await memberCount(results[0]!.conversation.id), 2);
  });

  it('aceite duplo (duas abas) cria UM membro', async () => {
    const owner = await makeUser('ow'); const guest = await makeUser('gu');
    await befriend(owner.id, guest.id);
    const g = await makeGroupWithMembers(owner.id, []);
    const invited = await createInvitations(owner.id, g, [guest.id]);
    assert.ok('results' in invited);
    const invitationId = invited.results[0]!.invitationId!;
    const outcomes = await Promise.all([1, 2, 3].map(() => acceptInvitation(guest.id, invitationId)));
    assert.ok(outcomes.every((o) => o.code === 'ok'));
    const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(conversationMembers).where(and(eq(conversationMembers.conversationId, g), eq(conversationMembers.userId, guest.id)));
    assert.equal(row!.n, 1);
  });

  it('a ultima vaga vai para UM so dos que aceitam ao mesmo tempo', async () => {
    const original = config.MAX_GROUP_MEMBERS;
    config.MAX_GROUP_MEMBERS = 3;
    try {
      const owner = await makeUser('sf'); const existing = await makeUser('sf');
      const g = await makeGroupWithMembers(owner.id, [existing.id]);
      const guests = await Promise.all([makeUser('sf'), makeUser('sf'), makeUser('sf')]);
      for (const guest of guests) await befriend(owner.id, guest.id);
      const invited = await createInvitations(owner.id, g, guests.map((x) => x.id));
      assert.ok('results' in invited);
      const outcomes = await Promise.all(guests.map((guest, i) => acceptInvitation(guest.id, invited.results[i]!.invitationId!)));
      assert.equal(outcomes.filter((o) => o.code === 'ok').length, 1, JSON.stringify(outcomes.map((o) => o.code)));
      assert.equal(outcomes.filter((o) => o.code === 'group_full').length, 2);
      assert.equal(await memberCount(g), 3);
    } finally {
      config.MAX_GROUP_MEMBERS = original;
    }
  });

  it('excluir o dono passa o grupo ao membro mais antigo, no mesmo lock, e audita', async () => {
    const admin = await makeUser('adm', 'admin');
    const owner = await makeUser('dead'); const oldest = await makeUser('old'); const newer = await makeUser('new');
    const g = await makeGroupWithMembers(owner.id, [oldest.id, newer.id]);
    const solo = await makeGroupWithMembers(owner.id, []);
    const result = await deleteUserAccount({ actor: { id: admin.id, username: admin.username }, reason: 'itest', requestId: '' }, owner.id, owner.username);
    assert.equal(result.code, 'ok');
    assert.deepEqual(await ownersOf(g), [oldest.id]);
    assert.equal((await db.select().from(conversations).where(eq(conversations.id, solo))).length, 0, 'grupo so com o dono some');
    const trail = await db.select().from(adminAuditLogs).where(and(eq(adminAuditLogs.action, 'group.owner_succession'), eq(adminAuditLogs.targetId, g)));
    assert.equal(trail.length, 1);
  });

  it('excluir o dono × transferir × sair (10 rodadas): o grupo nunca fica sem dono', async () => {
    const admin = await makeUser('adm', 'admin');
    for (let round = 0; round < 10; round++) {
      const owner = await makeUser('dx'); const b = await makeUser('m'); const c = await makeUser('m');
      const g = await makeGroupWithMembers(owner.id, [b.id, c.id]);
      await Promise.allSettled([
        deleteUserAccount({ actor: { id: admin.id, username: admin.username }, reason: 'itest', requestId: '' }, owner.id, owner.username),
        transferOwnership(g, owner.id, c.id),
        removeMember(g, c.id, c.id),
      ]);
      const members = await memberCount(g);
      const owners = await ownersOf(g);
      if (members > 0) assert.equal(owners.length, 1, `rodada ${round}: ${members} membros e ${owners.length} donos`);
      else assert.equal(owners.length, 0);
    }
  });
});

describe('convite nominal sem validade e sem cooldown (Postgres real)', () => {
  it('convite pendente nao expira e recusar nao bloqueia o reenvio', async () => {
    const owner = await makeUser('iv'); const guest = await makeUser('ig');
    await befriend(owner.id, guest.id);
    const g = await makeGroupWithMembers(owner.id, []);
    const first = await createInvitations(owner.id, g, [guest.id]);
    assert.ok('results' in first);
    const id = first.results[0]!.invitationId!;
    const [row] = await db.select().from(groupInvitations).where(eq(groupInvitations.id, id));
    assert.equal(row!.expiresAt, null);

    const declined = await declineInvitation(guest.id, id);
    assert.equal(declined.code, 'ok');
    const again = await createInvitations(owner.id, g, [guest.id]);
    assert.ok('results' in again);
    assert.equal(again.results[0]!.outcome, 'sent');
  });

  it('apagar o card revoga o convite pendente; quem ja entrou continua membro', async () => {
    const owner = await makeUser('dc'); const pending = await makeUser('dp'); const joined = await makeUser('dj');
    await befriend(owner.id, pending.id); await befriend(owner.id, joined.id);
    const g = await makeGroupWithMembers(owner.id, []);
    const sent = await createInvitations(owner.id, g, [pending.id, joined.id]);
    assert.ok('results' in sent);
    const [invPending, invJoined] = sent.results.map((r) => r.invitationId!);
    assert.equal((await acceptInvitation(joined.id, invJoined!)).code, 'ok');

    await revokeInvitationForDeletedCard(invPending!);
    await revokeInvitationForDeletedCard(invJoined!);

    const [p] = await db.select().from(groupInvitations).where(eq(groupInvitations.id, invPending!));
    const [j] = await db.select().from(groupInvitations).where(eq(groupInvitations.id, invJoined!));
    assert.equal(p!.status, 'revoked');
    assert.equal(j!.status, 'accepted');
    assert.equal((await acceptInvitation(pending.id, invPending!)).code, 'invalid_state');
    assert.equal(await memberCount(g), 2);
  });
});

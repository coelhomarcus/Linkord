import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, describe, it } from 'node:test';
import { eq } from 'drizzle-orm';
import { conversations, friendships, groupInvitations, notifications } from '../../src/db/schema.js';
import { listNotifications } from '../../src/modules/notifications/notificationsRepository.js';
import { befriend, db, makeGroupWithMembers, makeUser, pool } from './helpers.js';

after(() => pool.end());

async function notify(recipientId: string, kind: string, ref: { friendshipId?: string; invitationId?: string }): Promise<void> {
  await db.insert(notifications).values({
    id: crypto.randomUUID(), recipientId, kind, friendshipId: ref.friendshipId ?? null, groupInvitationId: ref.invitationId ?? null,
    dedupeKey: crypto.randomUUID(),
  });
}

async function pendingFriendship(requester: string, other: string): Promise<string> {
  const id = crypto.randomUUID();
  const [low, high] = requester < other ? [requester, other] : [other, requester];
  await db.insert(friendships).values({ id, userLowId: low, userHighId: high, requestedBy: requester, status: 'pending' });
  return id;
}

async function invite(groupId: string, inviter: string, invitee: string): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(groupInvitations).values({ id, conversationId: groupId, inviterId: inviter, inviteeId: invitee, expiresAt: new Date(Date.now() + 86_400_000) });
  return id;
}

describe('lista de notificacoes com ator e grupo (Postgres real)', () => {
  it('pedido: o ator e quem pediu; aceite: o ator e quem aceitou', async () => {
    const a = await makeUser('na'); const b = await makeUser('nb');
    const friendshipId = await pendingFriendship(a.id, b.id);
    await notify(b.id, 'friend_request', { friendshipId });
    await notify(a.id, 'friend_accepted', { friendshipId });

    const forB = await listNotifications(b.id);
    assert.ok(typeof forB !== 'string');
    assert.equal(forB.items.length, 1);
    assert.equal(forB.items[0]!.actor?.id, a.id);
    assert.equal(forB.items[0]!.group, null);
    assert.equal(forB.items[0]!.read, false);

    const forA = await listNotifications(a.id);
    assert.ok(typeof forA !== 'string');
    assert.equal(forA.items[0]!.kind, 'friend_accepted');
    assert.equal(forA.items[0]!.actor?.id, b.id);
    assert.equal('email' in (forA.items[0]!.actor ?? {}), false);
  });

  it('convite: traz o grupo; grupo apagado deixa a notificacao sem grupo', async () => {
    const owner = await makeUser('go'); const guest = await makeUser('gg');
    await befriend(owner.id, guest.id);
    const groupId = await makeGroupWithMembers(owner.id, [], 'Squad');
    const invitationId = await invite(groupId, owner.id, guest.id);
    await notify(guest.id, 'group_invitation', { invitationId });

    const before = await listNotifications(guest.id);
    assert.ok(typeof before !== 'string');
    assert.equal(before.items[0]!.actor?.id, owner.id);
    assert.deepEqual(before.items[0]!.group && { id: before.items[0]!.group.id, title: before.items[0]!.group.title }, { id: groupId, title: 'Squad' });

    await db.delete(conversations).where(eq(conversations.id, groupId));
    const after = await listNotifications(guest.id);
    assert.ok(typeof after !== 'string');
    // the invitation cascades with the group, so the notification row goes too
    assert.equal(after.items.length, 0);
  });

  it('outra conta nao ve a notificacao', async () => {
    const a = await makeUser('oa'); const b = await makeUser('ob'); const c = await makeUser('oc');
    const friendshipId = await pendingFriendship(a.id, b.id);
    await notify(b.id, 'friend_request', { friendshipId });
    const forC = await listNotifications(c.id);
    assert.ok(typeof forC !== 'string');
    assert.equal(forC.items.length, 0);
  });
});

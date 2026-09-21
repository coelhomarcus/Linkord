import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decideRemoval, decideTransfer } from '../../../src/modules/conversations/groupMembership.js';

describe('decideRemoval', () => {
  it('dono remove outro membro', () => {
    assert.equal(decideRemoval({ actorRole: 'owner', targetRole: 'member', isSelf: false, memberCount: 3 }), 'allow');
  });

  it('membro comum nao remove ninguem', () => {
    assert.equal(decideRemoval({ actorRole: 'member', targetRole: 'member', isSelf: false, memberCount: 3 }), 'forbidden');
    assert.equal(decideRemoval({ actorRole: 'member', targetRole: 'owner', isSelf: false, memberCount: 3 }), 'forbidden');
  });

  it('membro sai por conta propria', () => {
    assert.equal(decideRemoval({ actorRole: 'member', targetRole: 'member', isSelf: true, memberCount: 3 }), 'allow');
  });

  it('dono so sai quando esta sozinho — senao precisa transferir', () => {
    assert.equal(decideRemoval({ actorRole: 'owner', targetRole: 'owner', isSelf: true, memberCount: 2 }), 'owner_must_transfer');
    assert.equal(decideRemoval({ actorRole: 'owner', targetRole: 'owner', isSelf: true, memberCount: 1 }), 'allow');
  });

  it('quem nao e membro do grupo nao remove nem e removido', () => {
    assert.equal(decideRemoval({ actorRole: null, targetRole: 'member', isSelf: false, memberCount: 3 }), 'forbidden');
    assert.equal(decideRemoval({ actorRole: 'owner', targetRole: null, isSelf: false, memberCount: 3 }), 'not_member');
  });
});

describe('decideTransfer', () => {
  it('dono passa para um membro comum', () => {
    assert.equal(decideTransfer({ actorRole: 'owner', targetRole: 'member', isSelf: false }), 'allow');
  });

  it('so o dono transfere, e nunca para si mesmo', () => {
    assert.equal(decideTransfer({ actorRole: 'member', targetRole: 'member', isSelf: false }), 'forbidden');
    assert.equal(decideTransfer({ actorRole: null, targetRole: 'member', isSelf: false }), 'forbidden');
    assert.equal(decideTransfer({ actorRole: 'owner', targetRole: 'owner', isSelf: true }), 'forbidden');
  });

  it('alvo que saiu do grupo (ex.: removido no meio da corrida) nao vira dono', () => {
    assert.equal(decideTransfer({ actorRole: 'owner', targetRole: null, isSelf: false }), 'not_member');
  });
});

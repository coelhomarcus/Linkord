import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decideRemoval, decideTransfer } from '../../../src/modules/conversations/groupMembership.js';

describe('decideRemoval', () => {
  it('owner removes another member', () => {
    assert.equal(decideRemoval({ actorRole: 'owner', targetRole: 'member', isSelf: false, memberCount: 3 }), 'allow');
  });

  it('a regular member removes no one', () => {
    assert.equal(decideRemoval({ actorRole: 'member', targetRole: 'member', isSelf: false, memberCount: 3 }), 'forbidden');
    assert.equal(decideRemoval({ actorRole: 'member', targetRole: 'owner', isSelf: false, memberCount: 3 }), 'forbidden');
  });

  it('a member leaves on their own', () => {
    assert.equal(decideRemoval({ actorRole: 'member', targetRole: 'member', isSelf: true, memberCount: 3 }), 'allow');
  });

  it('the owner only leaves when alone — otherwise a transfer is required', () => {
    assert.equal(decideRemoval({ actorRole: 'owner', targetRole: 'owner', isSelf: true, memberCount: 2 }), 'owner_must_transfer');
    assert.equal(decideRemoval({ actorRole: 'owner', targetRole: 'owner', isSelf: true, memberCount: 1 }), 'allow');
  });

  it('someone who is not a group member neither removes nor is removed', () => {
    assert.equal(decideRemoval({ actorRole: null, targetRole: 'member', isSelf: false, memberCount: 3 }), 'forbidden');
    assert.equal(decideRemoval({ actorRole: 'owner', targetRole: null, isSelf: false, memberCount: 3 }), 'not_member');
  });
});

describe('decideTransfer', () => {
  it('owner transfers to a regular member', () => {
    assert.equal(decideTransfer({ actorRole: 'owner', targetRole: 'member', isSelf: false }), 'allow');
  });

  it('only the owner transfers, and never to themselves', () => {
    assert.equal(decideTransfer({ actorRole: 'member', targetRole: 'member', isSelf: false }), 'forbidden');
    assert.equal(decideTransfer({ actorRole: null, targetRole: 'member', isSelf: false }), 'forbidden');
    assert.equal(decideTransfer({ actorRole: 'owner', targetRole: 'owner', isSelf: true }), 'forbidden');
  });

  it('a target who left the group (e.g. removed mid-race) does not become owner', () => {
    assert.equal(decideTransfer({ actorRole: 'owner', targetRole: null, isSelf: false }), 'not_member');
  });
});

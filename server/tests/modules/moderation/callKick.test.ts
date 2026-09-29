import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canKickFromCall } from '../../../src/modules/moderation/moderation.js';

describe('canKickFromCall', () => {
  it('owner removes a member from their own group', () => {
    assert.equal(canKickFromCall({ actorIsAdmin: false, actorOwnsGroup: true, targetIsMember: true }), true);
  });

  it('owner does not remove someone who is not a member of that group', () => {
    assert.equal(canKickFromCall({ actorIsAdmin: false, actorOwnsGroup: true, targetIsMember: false }), false);
  });

  it('regular member removes no one', () => {
    assert.equal(canKickFromCall({ actorIsAdmin: false, actorOwnsGroup: false, targetIsMember: true }), false);
  });

  it('global admin keeps the power it already had (until step 11)', () => {
    assert.equal(canKickFromCall({ actorIsAdmin: true, actorOwnsGroup: false, targetIsMember: true }), true);
  });
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { canKickFromCall } from '../../../src/modules/moderation/moderation.js';

describe('canKickFromCall', () => {
  it('dono remove um membro do proprio grupo', () => {
    assert.equal(canKickFromCall({ actorIsAdmin: false, actorOwnsGroup: true, targetIsMember: true }), true);
  });

  it('dono nao remove quem nao e membro daquele grupo', () => {
    assert.equal(canKickFromCall({ actorIsAdmin: false, actorOwnsGroup: true, targetIsMember: false }), false);
  });

  it('membro comum nao remove ninguem', () => {
    assert.equal(canKickFromCall({ actorIsAdmin: false, actorOwnsGroup: false, targetIsMember: true }), false);
  });

  it('admin global mantem o poder que ja tinha (ate a etapa 11)', () => {
    assert.equal(canKickFromCall({ actorIsAdmin: true, actorOwnsGroup: false, targetIsMember: true }), true);
  });
});

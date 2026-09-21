import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { config } from '../../../src/config/env.js';
import { exceedsLimit, limitMax } from '../../../src/modules/limits/limits.js';
import { isRegistrationPaused } from '../../../src/modules/auth/registrationLimits.js';

describe('exceedsLimit', () => {
  it('chegar exatamente no teto ainda cabe; passar dele nao', () => {
    assert.equal(exceedsLimit(19, 20), false);
    assert.equal(exceedsLimit(20, 20), true);
    assert.equal(exceedsLimit(0, 20, 20), false);
    assert.equal(exceedsLimit(0, 20, 21), true);
  });

  it('serve para bytes: usado + em voo + o arquivo novo', () => {
    const max = 5 * 1024 ** 3;
    assert.equal(exceedsLimit(4 * 1024 ** 3, max, 1024 ** 3), false);
    assert.equal(exceedsLimit(4 * 1024 ** 3, max, 1024 ** 3 + 1), true);
  });
});

describe('limitMax', () => {
  it('le cada teto da configuracao', () => {
    assert.equal(limitMax('ownedGroups'), config.MAX_OWNED_GROUPS_PER_USER);
    assert.equal(limitMax('groupMemberships'), config.MAX_GROUP_MEMBERSHIPS_PER_USER);
    assert.equal(limitMax('friends'), config.MAX_FRIENDS);
    assert.equal(limitMax('pendingRequests'), config.MAX_PENDING_OUTGOING_REQUESTS);
    assert.equal(limitMax('storage'), config.MAX_USER_STORAGE_BYTES);
  });

  it('os padroes sao finitos e positivos (nenhum limite "esquecido" em zero ou NaN)', () => {
    for (const kind of ['storage', 'ownedGroups', 'groupMemberships', 'friends', 'pendingRequests'] as const) {
      const max = limitMax(kind);
      assert.ok(Number.isFinite(max) && max > 0, `${kind}=${max}`);
    }
  });
});

describe('isRegistrationPaused (disjuntor de cadastros)', () => {
  it('abaixo do teto segue; no teto pausa', () => {
    assert.equal(isRegistrationPaused(29, 30), false);
    assert.equal(isRegistrationPaused(30, 30), true);
    assert.equal(isRegistrationPaused(500, 30), true);
  });
});

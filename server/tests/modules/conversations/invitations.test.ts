import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { config } from '../../../src/config/env.js';
import { normalizeInviteeIds } from '../../../src/modules/conversations/invitationsRepository.js';

describe('normalizeInviteeIds', () => {
  it('dedupes, ignores garbage and never invites yourself', () => {
    const { ids, tooMany } = normalizeInviteeIds(['a', 'a', 'b', '', 7, null, 'me', { x: 1 }], 'me');
    assert.deepEqual(ids, ['a', 'b']);
    assert.equal(tooMany, false);
  });

  it('an input that is not a list becomes an empty list', () => {
    assert.deepEqual(normalizeInviteeIds('a,b', 'me'), { ids: [], tooMany: false });
    assert.deepEqual(normalizeInviteeIds(undefined, 'me'), { ids: [], tooMany: false });
  });

  it('a batch above the server limit is flagged, not silently truncated', () => {
    const many = Array.from({ length: config.MAX_INVITEES_PER_REQUEST + 1 }, (_, i) => `u${i}`);
    const result = normalizeInviteeIds(many, 'me');
    assert.equal(result.tooMany, true);
    assert.equal(result.ids.length, many.length);
    assert.equal(normalizeInviteeIds(many.slice(1), 'me').tooMany, false);
  });
});

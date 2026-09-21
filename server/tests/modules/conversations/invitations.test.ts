import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { config } from '../../../src/config/env.js';
import { normalizeInviteeIds } from '../../../src/modules/conversations/invitationsRepository.js';

describe('normalizeInviteeIds', () => {
  it('deduplica, ignora lixo e nunca convida a si mesmo', () => {
    const { ids, tooMany } = normalizeInviteeIds(['a', 'a', 'b', '', 7, null, 'me', { x: 1 }], 'me');
    assert.deepEqual(ids, ['a', 'b']);
    assert.equal(tooMany, false);
  });

  it('entrada que nao e lista vira lista vazia', () => {
    assert.deepEqual(normalizeInviteeIds('a,b', 'me'), { ids: [], tooMany: false });
    assert.deepEqual(normalizeInviteeIds(undefined, 'me'), { ids: [], tooMany: false });
  });

  it('lote acima do limite do servidor e sinalizado, nao truncado em silencio', () => {
    const many = Array.from({ length: config.MAX_INVITEES_PER_REQUEST + 1 }, (_, i) => `u${i}`);
    const result = normalizeInviteeIds(many, 'me');
    assert.equal(result.tooMany, true);
    assert.equal(result.ids.length, many.length);
    assert.equal(normalizeInviteeIds(many.slice(1), 'me').tooMany, false);
  });
});

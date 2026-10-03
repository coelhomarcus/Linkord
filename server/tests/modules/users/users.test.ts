import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isValidEmail, normalizeEmail } from '../../../src/modules/users/users.js';

describe('authentication email', () => {
  it('normalizes spaces and uppercase', () => {
    assert.equal(normalizeEmail('  Pessoa@Exemplo.COM '), 'pessoa@exemplo.com');
  });

  it('validates basic format and rejects incomplete values', () => {
    assert.equal(isValidEmail('pessoa@exemplo.com'), true);
    assert.equal(isValidEmail('pessoa@exemplo'), false);
    assert.equal(isValidEmail('pessoa exemplo.com'), false);
  });
});

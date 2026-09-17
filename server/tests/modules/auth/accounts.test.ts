import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../../../src/config/env.js';
import { isAdminUsername } from '../../../src/modules/auth/accounts.js';

describe('isAdminUsername', () => {
  const previous = config.ADMIN_USERNAME;
  test('compara sem diferenciar maiusculo/minusculo e ignorando espaco nas pontas', () => {
    config.ADMIN_USERNAME = 'marcus';
    assert.equal(isAdminUsername('marcus'), true);
    assert.equal(isAdminUsername('MARCUS'), true);
    assert.equal(isAdminUsername('  Marcus  '), true);
    assert.equal(isAdminUsername('outro'), false);
    config.ADMIN_USERNAME = previous;
  });
});

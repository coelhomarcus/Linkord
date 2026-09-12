import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isValidEmail, normalizeEmail } from './users.js';

describe('e-mail de autenticação', () => {
  it('normaliza espaços e maiúsculas', () => {
    assert.equal(normalizeEmail('  Pessoa@Exemplo.COM '), 'pessoa@exemplo.com');
  });

  it('valida formato básico e rejeita valores incompletos', () => {
    assert.equal(isValidEmail('pessoa@exemplo.com'), true);
    assert.equal(isValidEmail('pessoa@exemplo'), false);
    assert.equal(isValidEmail('pessoa exemplo.com'), false);
  });
});

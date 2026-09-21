import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createIsolatedDatabase, isLocalDatabaseUrl, isSafeIsolatedName, withDatabase } from '../../src/scripts/rehearsal/isolatedDb.js';

describe('guardas dos bancos isolados', () => {
  it('so aceita nomes linkord_test_* / linkord_rehearsal_*', () => {
    assert.equal(isSafeIsolatedName('linkord_test_ab12'), true);
    assert.equal(isSafeIsolatedName('linkord_rehearsal_x_9'), true);
    assert.equal(isSafeIsolatedName('linkord'), false);
    assert.equal(isSafeIsolatedName('call'), false);
    assert.equal(isSafeIsolatedName('linkord_test_prod'), false);
    assert.equal(isSafeIsolatedName('linkord_test_'), false);
  });

  it('so hosts locais', () => {
    assert.equal(isLocalDatabaseUrl('postgres://u:p@localhost:5432/linkord'), true);
    assert.equal(isLocalDatabaseUrl('postgres://u:p@127.0.0.1:5432/linkord'), true);
    assert.equal(isLocalDatabaseUrl('postgres://u:p@69.62.93.80:5562/call'), false);
    assert.equal(isLocalDatabaseUrl('nao-e-url'), false);
  });

  it('withDatabase troca so o nome do banco', () => {
    assert.equal(withDatabase('postgres://u:p@localhost:5432/linkord?x=1', 'postgres'), 'postgres://u:p@localhost:5432/postgres?x=1');
  });

  it('recusa criar banco em host remoto, antes de conectar', async () => {
    await assert.rejects(createIsolatedDatabase('postgres://u:p@69.62.93.80:5562/call', 'test'), /Postgres local/);
  });
});

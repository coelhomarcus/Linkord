import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import crypto from 'node:crypto';
import { pool } from './helpers.js';
import { getUsage } from '../../src/modules/attachments/attachmentQuota.js';

after(() => pool.end());

describe('getUsage (Postgres real) — o total da instancia agora inclui avatares/banners', () => {
  it('uma linha com message_id NULO (avatar/banner/foto de grupo) entra na soma', async () => {
    const before = await getUsage();
    const id = crypto.randomUUID().replace(/-/g, '');
    const size = 123_456;
    await pool.query(
      "insert into attachments (id, message_id, file_name, mime_type, size) values ($1, null, 'avatar', 'image/jpeg', $2)",
      [id, size],
    );
    const afterInsert = await getUsage();
    // >= (not ===) tolerant of other integration test files inserting
    // concurrently against the same shared test database — the point here
    // is proving inclusion, not an exact snapshot.
    assert.ok(afterInsert.totalBytes >= before.totalBytes + size, 'o tamanho do avatar deveria contar no total');
    assert.ok(afterInsert.totalFiles >= before.totalFiles + 1, 'o arquivo do avatar deveria contar no total de arquivos');
  });
});

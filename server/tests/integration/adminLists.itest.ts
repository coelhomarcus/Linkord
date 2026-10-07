import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { listAdminUsers } from '../../src/modules/admin/adminUsers.js';
import { makeUser, pool } from './helpers.js';

after(() => pool.end());

describe('admin user list filters (real Postgres)', () => {
  it('finds an account by its exact id, besides name and username', async () => {
    const target = await makeUser('idsearch');
    const other = await makeUser('idsearch');
    const byId = await listAdminUsers({ q: target.id });
    assert.ok(typeof byId === 'object');
    assert.deepEqual(byId.items.map((u) => u.id), [target.id]);

    const byName = await listAdminUsers({ q: target.username });
    assert.ok(typeof byName === 'object');
    assert.ok(byName.items.some((u) => u.id === target.id));
    assert.ok(!byName.items.some((u) => u.id === other.id));
  });

  it('an id is matched exactly: a prefix or a different case finds nothing', async () => {
    const target = await makeUser('idexact');
    for (const q of [target.id.slice(0, 12), target.id.toUpperCase()]) {
      const result = await listAdminUsers({ q });
      assert.ok(typeof result === 'object');
      assert.ok(!result.items.some((u) => u.id === target.id), `"${q}" must not match`);
    }
  });

  it('the role filter accepts plain users as well as admins', async () => {
    const plain = await makeUser('rolep', 'user');
    const admin = await makeUser('rolea', 'admin');
    const users = await listAdminUsers({ q: 'role', role: 'user' });
    const admins = await listAdminUsers({ q: 'role', role: 'admin' });
    assert.ok(typeof users === 'object' && typeof admins === 'object');
    assert.ok(users.items.some((u) => u.id === plain.id) && !users.items.some((u) => u.id === admin.id));
    assert.ok(admins.items.some((u) => u.id === admin.id) && !admins.items.some((u) => u.id === plain.id));
  });
});

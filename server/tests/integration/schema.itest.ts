import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import crypto from 'node:crypto';
import { pool, makeUser } from './helpers.js';

after(() => pool.end());

const tableExists = async (name: string) => (await pool.query('select to_regclass($1) as r', [`public.${name}`])).rows[0].r != null;

describe('schema no Postgres real', () => {
  it('as migrations levaram o banco ao topo (tabelas sociais, admin, denuncias, reparos)', async () => {
    for (const t of ['users', 'conversations', 'conversation_members', 'friendships', 'user_blocks', 'group_invitations', 'notifications', 'outbox_events', 'admin_audit_logs', 'reports', 'data_repairs']) {
      assert.equal(await tableExists(t), true, t);
    }
  });

  it('o indice unico garante no maximo UM dono por grupo', async () => {
    const a = await makeUser('own'); const b = await makeUser('own');
    const id = crypto.randomUUID();
    await pool.query("insert into conversations (id, type, title, updated_at) values ($1,'group','g', now())", [id]);
    await pool.query("insert into conversation_members (conversation_id, user_id, role) values ($1,$2,'owner')", [id, a.id]);
    await assert.rejects(pool.query("insert into conversation_members (conversation_id, user_id, role) values ($1,$2,'owner')", [id, b.id]), (err: { code?: string }) => err.code === '23505');
    await pool.query("insert into conversation_members (conversation_id, user_id, role) values ($1,$2,'member')", [id, b.id]);
  });

  it('dm_key e unica: nao existem duas DMs para o mesmo par', async () => {
    const key = `k:${crypto.randomUUID()}`;
    await pool.query("insert into conversations (id, type, dm_key, updated_at) values ($1,'direct',$2, now())", [crypto.randomUUID(), key]);
    await assert.rejects(pool.query("insert into conversations (id, type, dm_key, updated_at) values ($1,'direct',$2, now())", [crypto.randomUUID(), key]), (err: { code?: string }) => err.code === '23505');
  });

  it('a amizade guarda o par ordenado (low < high) e nao aceita o inverso', async () => {
    const a = await makeUser('fr'); const b = await makeUser('fr');
    const [low, high] = a.id < b.id ? [a.id, b.id] : [b.id, a.id];
    await assert.rejects(pool.query("insert into friendships (id, user_low_id, user_high_id, requested_by) values ($1,$2,$3,$2)", [crypto.randomUUID(), high, low]), (err: { code?: string }) => err.code === '23514');
  });
});

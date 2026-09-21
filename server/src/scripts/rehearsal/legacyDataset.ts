import type { Pool } from 'pg';

// A small, deterministic database as it looked BEFORE the social model
// (schema level 0019): the messy cases §12 and §14.1 name — ownerless groups,
// groups with several owners, unexpected roles, a direct conversation with an
// owner, a DM whose other side deleted their account, an empty group — next to
// clean data whose survival the rehearsal must prove (messages, attachments,
// reactions, pins, read markers, sessions).

const at = (iso: string) => new Date(iso);

export const USERS = ['ana', 'bia', 'caio', 'duda', 'eli'] as const;

interface GroupSeed { id: string; createdBy: string | null; members: [user: string, role: string, joinedAt: string][] }

export const GROUPS: GroupSeed[] = [
  { id: 'g-ok', createdBy: 'ana', members: [['ana', 'owner', '2025-01-01'], ['bia', 'member', '2025-01-02'], ['caio', 'member', '2025-01-03']] },
  { id: 'g-noowner-creator-in', createdBy: 'bia', members: [['bia', 'member', '2025-02-02'], ['caio', 'member', '2025-02-01']] },
  { id: 'g-noowner-creator-gone', createdBy: null, members: [['duda', 'member', '2025-03-05'], ['caio', 'member', '2025-03-01']] },
  { id: 'g-multi-creator', createdBy: 'ana', members: [['ana', 'owner', '2025-04-02'], ['bia', 'owner', '2025-04-01'], ['caio', 'member', '2025-04-03']] },
  { id: 'g-multi-no-creator', createdBy: null, members: [['eli', 'owner', '2025-05-09'], ['duda', 'owner', '2025-05-01']] },
  { id: 'g-role-admin', createdBy: 'ana', members: [['ana', 'owner', '2025-06-01'], ['bia', 'admin', '2025-06-02']] },
  { id: 'g-empty', createdBy: null, members: [] },
];

interface DmSeed { id: string; a: string; b: string | null; ownerOf?: string }
export const DMS: DmSeed[] = [
  { id: 'dm-ana-bia', a: 'ana', b: 'bia' },
  { id: 'dm-caio-duda', a: 'caio', b: 'duda', ownerOf: 'caio' },
  { id: 'dm-eli-gone', a: 'eli', b: null },
];

/** What the repair must decide for each messy group (the §12.2 rules). */
export const EXPECTED_OWNER: Record<string, string> = {
  'g-ok': 'ana',
  'g-noowner-creator-in': 'bia',
  'g-noowner-creator-gone': 'caio',
  'g-multi-creator': 'ana',
  'g-multi-no-creator': 'duda',
  'g-role-admin': 'ana',
};
/** Groups whose fix was a judgement call a person should look at. */
export const EXPECTED_REVIEW = ['g-noowner-creator-gone', 'g-multi-no-creator'];

export interface SeedManifest { users: Record<string, string>; counts: { messages: number; attachments: number; reactions: number; sessions: number; pinned: number; readMarkers: number; conversations: number } }

export async function seedLegacyDataset(pool: Pool): Promise<SeedManifest> {
  const users: Record<string, string> = {};
  for (const name of USERS) {
    users[name] = `u-${name}`;
    await pool.query("insert into users (id, username, password_hash, role) values ($1, $2, 'not-a-real-hash', 'user')", [users[name], name]);
  }
  const conv = async (id: string, type: string, createdBy: string | null, dmKey: string | null) =>
    pool.query('insert into conversations (id, type, title, created_by, dm_key, updated_at) values ($1,$2,$3,$4,$5, now())', [id, type, type === 'group' ? id : '', createdBy ? users[createdBy] : null, dmKey]);
  const member = async (id: string, user: string, role: string, joinedAt: Date) =>
    pool.query('insert into conversation_members (conversation_id, user_id, role, joined_at) values ($1,$2,$3,$4)', [id, users[user], role, joinedAt]);

  for (const g of GROUPS) {
    await conv(g.id, 'group', g.createdBy, null);
    for (const [user, role, joinedAt] of g.members) await member(g.id, user, role, at(joinedAt));
  }
  for (const d of DMS) {
    await conv(d.id, 'direct', null, [d.a, d.b].filter(Boolean).map((n) => users[n!]).sort().join(':'));
    await member(d.id, d.a, d.ownerOf === d.a ? 'owner' : 'member', at('2025-01-01'));
    if (d.b) await member(d.id, d.b, 'member', at('2025-01-01'));
  }

  // history worth keeping: text, authorless (deleted account), a reply target, files, reactions
  const message = async (conversationId: string, author: string | null, text: string): Promise<number> =>
    (await pool.query<{ id: number }>('insert into messages (conversation_id, author_id, text) values ($1,$2,$3) returning id', [conversationId, author ? users[author] : null, text])).rows[0]!.id;
  const m1 = await message('g-ok', 'ana', 'bem-vindos ao grupo');
  const m2 = await message('g-ok', 'bia', 'oi!');
  const m3 = await message('g-multi-creator', 'bia', 'quem manda aqui?');
  await message('dm-ana-bia', 'ana', 'conversa antiga');
  await message('dm-eli-gone', null, 'mensagem de uma conta apagada');
  await message('dm-eli-gone', 'eli', 'alguém aí?');
  await pool.query("insert into attachments (id, message_id, file_name, mime_type, size) values ('legacyfile0000000000000000000001', $1, 'foto.png', 'image/png', 1234), ('legacyfile0000000000000000000002', $2, 'nota.txt', 'text/plain', 88)", [m1, m3]);
  await pool.query("insert into message_reactions (message_id, user_id, emoji) values ($1,$2,'👍'), ($1,$3,'❤️')", [m1, users.bia, users.caio]);
  await pool.query("update conversation_members set pinned_at = $3 where conversation_id = $1 and user_id = $2", ['g-ok', users.bia, at('2025-07-01')]);
  await pool.query("update conversation_members set last_read_message_id = $3 where conversation_id = $1 and user_id = $2", ['g-ok', users.caio, m2]);
  for (const name of ['ana', 'bia']) {
    await pool.query("insert into sessions (token_hash, user_id, expires_at) values ($1,$2, now() + interval '30 days')", [`hash-${name}`, users[name]]);
  }

  const count = async (sql: string) => Number((await pool.query<{ n: string }>(sql)).rows[0]!.n);
  return {
    users,
    counts: {
      messages: await count('select count(*) as n from messages'),
      attachments: await count('select count(*) as n from attachments'),
      reactions: await count('select count(*) as n from message_reactions'),
      sessions: await count('select count(*) as n from sessions'),
      pinned: await count('select count(*) as n from conversation_members where pinned_at is not null'),
      readMarkers: await count('select count(*) as n from conversation_members where last_read_message_id is not null'),
      conversations: await count('select count(*) as n from conversations'),
    },
  };
}

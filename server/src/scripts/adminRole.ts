import { pool } from '../db/client.js';
import { findByUsernameLower } from '../modules/users/users.js';
import { CLI_ACTOR_ID, setAdminRole } from '../modules/admin/adminUsers.js';

// `npm run admin:grant -- <username>` / `npm run admin:revoke -- <username>`
//
// The way the first administrator is created (a sign-up never grants admin)
// and the recovery path if every admin is locked out. Runs against
// DATABASE_URL, needs shell access to the server, and leaves the same audit
// entry as the /admin area, with the actor recorded as `cli`.

const action = process.argv[2];
const username = (process.argv[3] ?? '').trim();

async function main(): Promise<number> {
  if ((action !== 'grant' && action !== 'revoke') || !username) {
    console.error('uso: admin:grant|admin:revoke -- <usuario>');
    return 2;
  }
  const target = await findByUsernameLower(username);
  if (!target) {
    console.error(`conta "${username}" não encontrada`);
    return 1;
  }
  const result = await setAdminRole({ actor: { id: CLI_ACTOR_ID, username: 'cli' }, reason: `via linha de comando (${action})`, requestId: '' }, target.id, action);
  if (result.code !== 'ok') {
    console.error(`nada mudou: ${result.code}`);
    return 1;
  }
  console.log(`${action === 'grant' ? 'administrador concedido a' : 'administrador removido de'} @${target.username}`);
  return 0;
}

main()
  .then((code) => { process.exitCode = code; })
  .catch((err) => { console.error(err instanceof Error ? err.stack : err); process.exitCode = 1; })
  .finally(() => { void pool.end(); });

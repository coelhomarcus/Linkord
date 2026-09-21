import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createIsolatedDatabase } from './rehearsal/isolatedDb.js';
import { makeMigrationsFolder } from './rehearsal/migrationFolders.js';
import { migrateOn } from './rehearsal/migrateOn.js';

// `npm run test:integration`
//
// Runs server/tests/integration/**/*.itest.ts against a REAL Postgres: a fresh
// `linkord_test_*` database on the local server, migrated to the current schema,
// dropped when the run ends (docs/plano-rede-social.md §14.1). The unit suite
// (`npm run test:server`) never touches a database; this one exists for the
// invariants only a real one can prove — unique owner, idempotent DM, races.
// The child process only ever sees the throwaway database's URL.

function findTests(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findTests(full));
    else if (entry.name.endsWith('.itest.ts')) out.push(full);
  }
  return out.sort();
}

async function main(): Promise<number> {
  const baseUrl = process.env.DATABASE_URL;
  if (!baseUrl) { console.error('DATABASE_URL não configurada'); return 2; }
  const root = path.join(import.meta.dirname, '..', '..', 'tests', 'integration');
  const files = findTests(root);
  if (files.length === 0) { console.error('nenhum *.itest.ts encontrado'); return 2; }

  const db = await createIsolatedDatabase(baseUrl, 'test');
  const folder = makeMigrationsFolder();
  const cleanup = async () => { folder.cleanup(); await db.drop().catch((err) => console.error(`não consegui derrubar ${db.name}:`, err)); };
  process.once('SIGINT', () => { void cleanup().finally(() => process.exit(130)); });
  try {
    await migrateOn(db.pool, folder.folder);
    console.log(`[integration] banco ${db.name} migrado; ${files.length} arquivo(s)`);
    const env = { ...process.env, DATABASE_URL: db.url, TEST_DATABASE_BASE_URL: baseUrl, MIGRATE_ON_BOOT: '0' } as NodeJS.ProcessEnv;
    delete env.DATABASE_URL_PROD;
    const child = spawn(process.execPath, ['--import', 'tsx', '--test', '--test-concurrency=1', ...files], { env, stdio: 'inherit' });
    return await new Promise<number>((resolve) => child.on('exit', (code) => resolve(code ?? 1)));
  } finally {
    await cleanup();
  }
}

main().then((code) => { process.exitCode = code; }).catch((err) => { console.error(err instanceof Error ? err.stack : err); process.exitCode = 1; });

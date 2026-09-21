import { Pool } from 'pg';
import { classifyInventory, formatFindings, loadInventory } from '../modules/migration/legacyInventory.js';

// `npm run db:preflight [-- --json] [-- --database-url=<url>]`
// Read-only inventory of legacy data (docs/plano-rede-social.md §12.1). Exit
// code 1 only when something would BLOCK a pending migration; warnings exit 0.

const args = process.argv.slice(2);
const json = args.includes('--json');
const url = args.find((a) => a.startsWith('--database-url='))?.slice('--database-url='.length) || process.env.DATABASE_URL;

async function main(): Promise<number> {
  if (!url) { console.error('DATABASE_URL não configurada'); return 2; }
  const pool = new Pool({ connectionString: url });
  try {
    const findings = classifyInventory(await loadInventory(pool));
    console.log(json ? JSON.stringify(findings, null, 2) : formatFindings(findings));
    return findings.blockers.length > 0 ? 1 : 0;
  } finally {
    await pool.end();
  }
}

main().then((code) => { process.exitCode = code; }).catch((err) => { console.error(err instanceof Error ? err.stack : err); process.exitCode = 2; });

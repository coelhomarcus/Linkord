import { Pool } from 'pg';
import { classifyInventory, loadInventory, planRepairs, type RepairAction } from '../modules/migration/legacyInventory.js';
import { applyRepairs } from '../modules/migration/legacyRepair.js';

// `npm run db:repair`            → shows the plan, changes nothing
// `npm run db:repair -- --apply` → applies it in one transaction and logs each change in data_repairs
// Idempotent: a second run finds nothing to do. Never deletes anything, never
// creates a friendship or an invitation (docs/plano-rede-social.md §12).

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const url = args.find((a) => a.startsWith('--database-url='))?.slice('--database-url='.length) || process.env.DATABASE_URL;

function describe(a: RepairAction): string {
  return `  ${a.needsReview ? '⚠ ' : '  '}${a.kind.padEnd(20)} grupo ${a.conversationId}  membro ${a.userId}  ${a.before.role} → ${a.after.role}  (${a.note})`;
}

async function main(): Promise<number> {
  if (!url) { console.error('DATABASE_URL não configurada'); return 2; }
  const pool = new Pool({ connectionString: url });
  try {
    const inventory = await loadInventory(pool);
    const findings = classifyInventory(inventory);
    const plan = planRepairs(inventory);
    if (plan.length === 0) {
      console.log('Nada a corrigir.');
    } else {
      console.log(`${plan.length} correção(ões) planejada(s) (⚠ = precisa de revisão humana):`);
      for (const action of plan) console.log(describe(action));
    }
    if (findings.emptyGroups.length) console.log(`\nSó relatado (não é apagado): ${findings.emptyGroups.length} grupo(s) vazio(s): ${findings.emptyGroups.join(', ')}`);
    if (findings.directIncomplete.length) console.log(`Só relatado: ${findings.directIncomplete.length} DM(s) com associação incompleta.`);

    if (!apply) {
      if (plan.length) console.log('\nDry-run: nada foi alterado. Revise e rode com --apply.');
      return 0;
    }
    const run = await applyRepairs(pool, plan);
    console.log(`\nAplicado: ${run.applied.length} correção(ões) (run ${run.runId}).`);
    if (run.skipped.length) {
      console.log(`Ignoradas (o dado mudou desde o plano): ${run.skipped.length}`);
      for (const s of run.skipped) console.log(`${describe(s.action)}  → ${s.reason}`);
    }
    return 0;
  } finally {
    await pool.end();
  }
}

main().then((code) => { process.exitCode = code; }).catch((err) => { console.error(err instanceof Error ? err.stack : err); process.exitCode = 1; });

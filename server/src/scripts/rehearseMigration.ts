import type { Pool } from 'pg';
import { classifyInventory, loadInventory, planRepairs } from '../modules/migration/legacyInventory.js';
import { applyRepairs, InjectedRepairFailure } from '../modules/migration/legacyRepair.js';
import { LegacyDataBlockedError } from '../modules/migration/migrationGate.js';
import { createIsolatedDatabase, type IsolatedDatabase } from './rehearsal/isolatedDb.js';
import { EXPECTED_OWNER, EXPECTED_REVIEW, seedLegacyDataset, type SeedManifest } from './rehearsal/legacyDataset.js';
import { journalTags, makeMigrationsFolder } from './rehearsal/migrationFolders.js';
import { migrateOn } from './rehearsal/migrateOn.js';

// `npm run db:rehearse [-- --keep] [-- --json]`
//
// Rehearses the production migration end to end on throwaway local databases
// (docs/plano-rede-social.md §12, §14.1 "Migração"): the database as it was
// before the social model, loaded with messy legacy data, taken to the current
// schema through the same safety gate the server uses — and proves that the
// data and the social policy survive. It never touches DATABASE_URL_PROD or the
// development database: everything happens in `linkord_rehearsal_*` databases it
// creates and drops.

const args = process.argv.slice(2);
const keep = args.includes('--keep');
const asJson = args.includes('--json');

interface Step { name: string; ok: boolean; detail?: string }
const steps: Step[] = [];
const check = (name: string, ok: boolean, detail = ''): boolean => { steps.push({ name, ok, detail }); if (!asJson) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`); return ok; };
const note = (text: string) => { if (!asJson) console.log(`\n▸ ${text}`); };

const rolesSnapshot = async (pool: Pool): Promise<string> =>
  JSON.stringify((await pool.query('select conversation_id, user_id, role from conversation_members order by 1, 2')).rows);
const tableExists = async (pool: Pool, name: string): Promise<boolean> => (await pool.query('select to_regclass($1) as r', [`public.${name}`])).rows[0]!.r != null;
const count = async (pool: Pool, sql: string): Promise<number> => Number((await pool.query<{ n: string }>(sql)).rows[0]!.n);

/** A database frozen at the last migration before the social model, seeded with the legacy dataset. */
async function legacyDatabase(baseUrl: string, label: string): Promise<{ db: IsolatedDatabase; manifest: SeedManifest }> {
  const db = await createIsolatedDatabase(baseUrl, 'rehearsal', `${label}_${Date.now().toString(36)}`);
  const legacyFolder = makeMigrationsFolder({ toIdx: 19 });
  try {
    await migrateOn(db.pool, legacyFolder.folder);
  } finally {
    legacyFolder.cleanup();
  }
  return { db, manifest: await seedLegacyDataset(db.pool) };
}

async function main(): Promise<number> {
  const baseUrl = process.env.DATABASE_URL;
  if (!baseUrl) { console.error('DATABASE_URL não configurada'); return 2; }
  const dbs: IsolatedDatabase[] = [];
  try {
    check(`journal tem as migrations 0000–0019 (estado pré-rede-social) e mais ${journalTags().length - 20} depois`, journalTags().length > 20 && journalTags()[19]!.startsWith('0019'));

    // ---- A: the legacy database and the safe way to bring it forward
    note('Banco legado (schema até a 0019) com dados representativos');
    const { db: A, manifest } = await legacyDatabase(baseUrl, 'a');
    dbs.push(A);
    check('legado semeado (grupos com/sem dono, multi-dono, papel inesperado, DMs incompletas, vazio)', manifest.counts.conversations === 10, JSON.stringify(manifest.counts));

    const findings = classifyInventory(await loadInventory(A.pool));
    check('preflight detecta o bloqueador (grupos com mais de um dono)', findings.blockers.length > 0 && findings.groupsWithMultipleOwners.length === 2, `bloqueadores=${findings.blockers.length}`);
    check('preflight inventaria sem-dono, papel inesperado, DM com dono, DM incompleta e grupo vazio',
      findings.groupsWithoutOwner.length === 2 && findings.unexpectedRoles.length === 1 && findings.directWithOwner.length === 1 && findings.directIncomplete.length === 1 && findings.emptyGroups.length === 1);

    const full = makeMigrationsFolder();
    let refused: unknown = null;
    try { await migrateOn(A.pool, full.folder); } catch (err) { refused = err; }
    check('o boot RECUSA migrar por cima do legado bloqueado (LegacyDataBlockedError)', refused instanceof LegacyDataBlockedError);
    check('recusar não deixou nada pela metade (nenhuma migration nova aplicada)', !(await tableExists(A.pool, 'friendships')) && !(await tableExists(A.pool, 'admin_audit_logs')));

    note('Reparo: plano → falha injetada → aplicação');
    const before = await rolesSnapshot(A.pool);
    const plan = planRepairs(await loadInventory(A.pool));
    check('dry-run: plano cobre exatamente os casos ruins e nada foi alterado', plan.length === 6 && (await rolesSnapshot(A.pool)) === before, `${plan.length} ação(ões)`);
    const reviewGroups = [...new Set(plan.filter((a) => a.needsReview).map((a) => a.conversationId))].sort();
    check('decisões ambíguas ficam marcadas para revisão humana', JSON.stringify(reviewGroups) === JSON.stringify([...EXPECTED_REVIEW].sort()), reviewGroups.join(', '));

    let injected: unknown = null;
    try { await applyRepairs(A.pool, plan, { failAfter: 2 }); } catch (err) { injected = err; }
    check('falha no meio do reparo: nada muda e o log também é desfeito', injected instanceof InjectedRepairFailure && (await rolesSnapshot(A.pool)) === before && !(await tableExists(A.pool, 'data_repairs')));

    const run = await applyRepairs(A.pool, plan);
    check('retomada: o reparo conclui na segunda tentativa, sem ignorados', run.applied.length === plan.length && run.skipped.length === 0);
    check('data_repairs registra cada correção (com marca de revisão)', (await count(A.pool, 'select count(*) as n from data_repairs')) === plan.length && (await count(A.pool, 'select count(*) as n from data_repairs where needs_review')) === plan.filter((a) => a.needsReview).length);

    note('Migração até o topo e verificação do §12');
    await migrateOn(A.pool, full.folder);
    check('migra 0020 → topo depois do reparo', (await tableExists(A.pool, 'friendships')) && (await tableExists(A.pool, 'admin_audit_logs')) && (await tableExists(A.pool, 'reports')) && (await tableExists(A.pool, 'data_repairs')));
    const c = manifest.counts;
    check('mensagens, anexos, reações, sessões e conversas preservados',
      (await count(A.pool, 'select count(*) as n from messages')) === c.messages && (await count(A.pool, 'select count(*) as n from attachments')) === c.attachments
      && (await count(A.pool, 'select count(*) as n from message_reactions')) === c.reactions && (await count(A.pool, 'select count(*) as n from sessions')) === c.sessions
      && (await count(A.pool, 'select count(*) as n from conversations')) === c.conversations);
    check('fixações e marcadores de leitura preservados', (await count(A.pool, 'select count(*) as n from conversation_members where pinned_at is not null')) === c.pinned && (await count(A.pool, 'select count(*) as n from conversation_members where last_read_message_id is not null')) === c.readMarkers);
    check('nenhuma amizade, convite ou notificação foi criada pela migração', (await count(A.pool, 'select count(*) as n from friendships')) === 0 && (await count(A.pool, 'select count(*) as n from group_invitations')) === 0 && (await count(A.pool, 'select count(*) as n from notifications')) === 0);
    check('DMs legadas continuam (inclusive a de conta apagada) e sem dono', (await count(A.pool, "select count(*) as n from conversations where type = 'direct'")) === 3 && (await count(A.pool, "select count(*) as n from conversation_members m join conversations c on c.id = m.conversation_id where c.type = 'direct' and m.role = 'owner'")) === 0);
    const owners = Object.fromEntries((await A.pool.query<{ conversation_id: string; user_id: string }>("select conversation_id, user_id from conversation_members where role = 'owner'")).rows.map((r) => [r.conversation_id, r.user_id]));
    check('cada grupo não vazio tem EXATAMENTE um dono, e é o previsto pelas regras do §12.2',
      Object.entries(EXPECTED_OWNER).every(([group, user]) => owners[group] === manifest.users[user]) && Object.keys(owners).filter((id) => id.startsWith('g-')).length === Object.keys(EXPECTED_OWNER).length, JSON.stringify(Object.fromEntries(Object.entries(owners).filter(([id]) => id.startsWith('g-')))));
    check('papel inesperado virou membro', (await count(A.pool, "select count(*) as n from conversation_members where role not in ('owner','member')")) === 0);
    check('grupo vazio foi só relatado (continua existindo)', (await count(A.pool, "select count(*) as n from conversations where id = 'g-empty'")) === 1);
    const again = planRepairs(await loadInventory(A.pool));
    const rerun = await applyRepairs(A.pool, again);
    check('idempotente: depois do reparo o plano é vazio e reaplicar não muda nada', again.length === 0 && rerun.applied.length === 0);
    full.cleanup();

    // ---- B: a migration that dies half-way, then resumes
    note('Migração interrompida no meio e retomada');
    const { db: B } = await legacyDatabase(baseUrl, 'b');
    dbs.push(B);
    await applyRepairs(B.pool, planRepairs(await loadInventory(B.pool)));
    const broken = makeMigrationsFolder({ brokenAfterIdx: 21 });
    let failed: unknown = null;
    try { await migrateOn(B.pool, broken.folder); } catch (err) { failed = err; }
    check('a migration quebrada falha (e não é o portão de dados legados)', failed !== null && !(failed instanceof LegacyDataBlockedError));
    check('a migração é ATÔMICA: a falha desfez tudo (nem as migrations boas antes da quebrada ficaram pela metade)',
      !(await tableExists(B.pool, 'conversation_members_one_owner_idx')) && !(await tableExists(B.pool, 'friendships')) && !(await tableExists(B.pool, 'rehearsal_before_failure')) && !(await tableExists(B.pool, 'admin_audit_logs')));
    broken.cleanup();
    const good = makeMigrationsFolder();
    await migrateOn(B.pool, good.folder);
    check('retomada: sem a quebrada, tudo aplica de uma vez e chega ao topo', (await tableExists(B.pool, 'admin_audit_logs')) && (await tableExists(B.pool, 'reports')) && (await tableExists(B.pool, 'data_repairs')));
    good.cleanup();

    // ---- C: a brand new database
    note('Banco vazio');
    const empty = await createIsolatedDatabase(baseUrl, 'rehearsal', `c_${Date.now().toString(36)}`);
    dbs.push(empty);
    const fresh = makeMigrationsFolder();
    await migrateOn(empty.pool, fresh.folder);
    check('banco novo migra do zero ao topo sem o portão atrapalhar', (await tableExists(empty.pool, 'users')) && (await tableExists(empty.pool, 'reports')) && (await tableExists(empty.pool, 'data_repairs')));
    fresh.cleanup();
  } catch (err) {
    check('o ensaio terminou sem exceção inesperada', false, err instanceof Error ? err.stack ?? err.message : String(err));
  } finally {
    if (!keep) for (const db of dbs) await db.drop().catch((err) => console.error(`não consegui derrubar ${db.name}:`, err));
    else console.log(`\n--keep: bancos mantidos: ${dbs.map((d) => d.name).join(', ')}`);
  }

  const failed = steps.filter((s) => !s.ok);
  if (asJson) console.log(JSON.stringify({ ok: failed.length === 0, steps }, null, 2));
  else console.log(failed.length === 0 ? `\nENSAIO OK — ${steps.length} verificações` : `\n${failed.length} VERIFICAÇÃO(ÕES) FALHARAM`);
  return failed.length === 0 ? 0 : 1;
}

main().then((code) => { process.exitCode = code; }).catch((err) => { console.error(err instanceof Error ? err.stack : err); process.exitCode = 1; });

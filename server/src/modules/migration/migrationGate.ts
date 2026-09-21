import { classifyInventory, formatFindings, loadInventory, type Findings, type Queryable } from './legacyInventory.js';

// Some migrations cannot apply to legacy data as-is (a unique index over rows
// that already violate it). Running them anyway would half-migrate the database
// and then kill the boot, so the server checks first and refuses — telling the
// operator exactly what to do — instead of "repairing" data on its own
// (docs/plano-rede-social.md §12: corrections are reviewed, never silent).

interface Precondition {
  migration: string;
  /** true while the migration has NOT been applied yet (and the table it touches exists) */
  isPending(db: Queryable): Promise<boolean>;
  blockedBy(f: Findings): string[];
}

const indexExists = async (db: Queryable, name: string): Promise<boolean> => (await db.query('select to_regclass($1) as r', [`public.${name}`])).rows[0]?.r != null;
const tableExists = async (db: Queryable, name: string): Promise<boolean> => (await db.query('select to_regclass($1) as r', [`public.${name}`])).rows[0]?.r != null;

export const MIGRATION_PRECONDITIONS: Precondition[] = [
  {
    migration: '0020 — um dono por grupo',
    isPending: async (db) => (await tableExists(db, 'conversation_members')) && !(await indexExists(db, 'conversation_members_one_owner_idx')),
    blockedBy: (f) => (f.groupsWithMultipleOwners.length ? [`grupos com mais de um dono: ${f.groupsWithMultipleOwners.join(', ')}`] : []),
  },
  {
    migration: '0011 — unicidade de DM',
    isPending: async (db) => (await tableExists(db, 'conversations')) && !(await indexExists(db, 'conversations_dm_key_unique')),
    blockedBy: (f) => (f.duplicateDmKeys.length ? [`dm_key duplicada: ${f.duplicateDmKeys.join(', ')}`] : []),
  },
];

export class LegacyDataBlockedError extends Error {
  readonly reasons: string[];
  readonly report: string;

  constructor(reasons: string[], report: string) {
    super(`Migração bloqueada por dados legados: ${reasons.join(' | ')}`);
    this.reasons = reasons;
    this.report = report;
  }
}

export const REPAIR_INSTRUCTIONS = [
  'Nada foi migrado. Para corrigir:',
  '  1. npm run db:preflight                 (inventário, só leitura)',
  '  2. npm run db:repair                    (mostra o plano, não altera nada)',
  '  3. revise as linhas "needs_review" e rode: npm run db:repair -- --apply',
  '  4. suba o servidor de novo.',
].join('\n');

/** Throws LegacyDataBlockedError when a pending migration would fail on the
 * current data. A fresh database (no tables yet) and an already-repaired one
 * pass after a couple of cheap catalog reads. */
export async function assertMigrationsSafe(db: Queryable): Promise<void> {
  const pending: Precondition[] = [];
  for (const p of MIGRATION_PRECONDITIONS) if (await p.isPending(db)) pending.push(p);
  if (pending.length === 0) return;
  if (!(await tableExists(db, 'conversation_members'))) return;

  const findings = classifyInventory(await loadInventory(db));
  const reasons = pending.flatMap((p) => p.blockedBy(findings).map((r) => `${p.migration}: ${r}`));
  if (reasons.length > 0) throw new LegacyDataBlockedError(reasons, formatFindings(findings));
}

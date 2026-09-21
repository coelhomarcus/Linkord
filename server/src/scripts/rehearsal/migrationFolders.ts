import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MIGRATIONS_FOLDER } from '../../db/migrate.js';

interface JournalEntry { idx: number; version: string; when: number; tag: string; breakpoints: boolean }
interface Journal { version: string; dialect: string; entries: JournalEntry[] }

const readJournal = (): Journal => JSON.parse(fs.readFileSync(path.join(MIGRATIONS_FOLDER, 'meta', '_journal.json'), 'utf8'));

export const journalTags = (): string[] => readJournal().entries.map((e) => e.tag);
export const lastIdx = (): number => readJournal().entries.length - 1;

/** A copy of the migrations folder holding only entries `fromIdx`..`toIdx` of the
 * real journal (the drizzle runner reads nothing else), optionally with an extra
 * broken migration spliced in at a given position — used to rehearse "the
 * database as it was before the social model" and "a migration that dies half-way". */
export function makeMigrationsFolder(opts: { toIdx?: number; brokenAfterIdx?: number } = {}): { folder: string; cleanup(): void; brokenTag: string | null } {
  const journal = readJournal();
  const toIdx = opts.toIdx ?? journal.entries.length - 1;
  const entries = journal.entries.filter((e) => e.idx <= toIdx);
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'linkord-migrations-'));
  fs.mkdirSync(path.join(folder, 'meta'));
  for (const e of entries) fs.copyFileSync(path.join(MIGRATIONS_FOLDER, `${e.tag}.sql`), path.join(folder, `${e.tag}.sql`));

  let brokenTag: string | null = null;
  const out: JournalEntry[] = [...entries];
  if (opts.brokenAfterIdx !== undefined) {
    const before = entries.find((e) => e.idx === opts.brokenAfterIdx)!;
    const next = entries.find((e) => e.idx === opts.brokenAfterIdx! + 1);
    brokenTag = '9999_broken_on_purpose';
    fs.writeFileSync(path.join(folder, `${brokenTag}.sql`), 'CREATE TABLE rehearsal_before_failure (id int);\n--> statement-breakpoint\nTHIS IS NOT VALID SQL;');
    const when = next ? Math.floor((before.when + next.when) / 2) : before.when + 1;
    out.splice(out.indexOf(before) + 1, 0, { idx: before.idx + 1, version: '7', when, tag: brokenTag, breakpoints: true });
  }
  fs.writeFileSync(path.join(folder, 'meta', '_journal.json'), JSON.stringify({ ...journal, entries: out }, null, 2));
  return { folder, brokenTag, cleanup: () => fs.rmSync(folder, { recursive: true, force: true }) };
}

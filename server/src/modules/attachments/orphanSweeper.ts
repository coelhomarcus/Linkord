import fs from 'node:fs/promises';
import { config } from '../../config/env.js';
import { db } from '../../db/client.js';
import { attachments } from '../../db/schema.js';
import { recordAudit, recordAuditFailure, type AuditActor } from '../admin/auditLog.js';
import { filePathFor } from './attachmentStorage.js';
import { logger } from '../../lib/logger.js';

const log = logger.child({ component: 'audit' });

// Files on disk that no `attachments` row points to. Deleting a group/account/
// message removes rows and files in separate steps, and a failed unlink leaves
// the file behind forever — this is the periodic net under all of them
// (docs/plano-rede-social.md §11: "coleta de órfãos"). It only ever considers
// files older than a grace period, so an upload being committed right now is
// never mistaken for one.

const FILE_ID_RE = /^[0-9a-f]{32}$/;

export interface DiskFile { name: string; size: number; mtimeMs: number }

export interface OrphanClassification {
  orphans: DiskFile[];
  /** files with no row that are still inside the grace period */
  recent: number;
  tracked: number;
  /** rows whose file is not on disk (reported only, never "fixed") */
  missingFiles: number;
}

/** Pure: split what is on disk against what the database knows. */
export function classifyOrphans(input: { files: DiskFile[]; dbIds: Set<string>; now: number; graceMs: number }): OrphanClassification {
  const { files, dbIds, now, graceMs } = input;
  const onDisk = new Set(files.map((f) => f.name));
  const orphans: DiskFile[] = [];
  let recent = 0;
  let tracked = 0;
  for (const file of files) {
    if (dbIds.has(file.name)) tracked++;
    else if (now - file.mtimeMs < graceMs) recent++;
    else orphans.push(file);
  }
  let missingFiles = 0;
  for (const id of dbIds) if (!onDisk.has(id)) missingFiles++;
  return { orphans, recent, tracked, missingFiles };
}

export interface SweepResult {
  at: string;
  dryRun: boolean;
  scanned: number;
  orphanCount: number;
  orphanBytes: number;
  deleted: number;
  failed: number;
  recent: number;
  missingFiles: number;
}

let lastSweep: SweepResult | null = null;
export const getLastSweep = (): SweepResult | null => lastSweep;

async function listDiskFiles(): Promise<DiskFile[]> {
  let names: string[];
  try {
    names = await fs.readdir(config.UPLOAD_DIR);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const files: DiskFile[] = [];
  for (const name of names) {
    if (!FILE_ID_RE.test(name)) continue; // tmp/ and anything that isn't ours
    try {
      const stat = await fs.stat(filePathFor(name));
      if (stat.isFile()) files.push({ name, size: stat.size, mtimeMs: stat.mtimeMs });
    } catch { /* vanished while listing */ }
  }
  return files;
}

/** `actor` null = the scheduled run. A real (non-dry) run leaves an audit
 * entry; every file it could not delete becomes a `failed` entry instead of
 * disappearing into the log. */
export async function sweepOrphans(opts: { dryRun: boolean; actor: AuditActor | null; requestId?: string; reason?: string }): Promise<SweepResult> {
  const files = await listDiskFiles();
  const dbIds = new Set((await db.select({ id: attachments.id }).from(attachments)).map((r) => r.id));
  const { orphans, recent, missingFiles } = classifyOrphans({ files, dbIds, now: Date.now(), graceMs: config.ORPHAN_GRACE_MS });

  let deleted = 0;
  let failed = 0;
  if (!opts.dryRun) {
    for (const file of orphans) {
      try {
        await fs.unlink(filePathFor(file.name));
        deleted++;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') { deleted++; continue; }
        failed++;
        await recordAuditFailure({ actor: opts.actor, action: 'storage.orphan_delete', targetType: 'system', targetId: file.name, requestId: opts.requestId }, err);
      }
    }
  }

  const result: SweepResult = {
    at: new Date().toISOString(), dryRun: opts.dryRun, scanned: files.length, orphanCount: orphans.length,
    orphanBytes: orphans.reduce((sum, f) => sum + f.size, 0), deleted, failed, recent, missingFiles,
  };
  lastSweep = result;
  if (!opts.dryRun && (deleted > 0 || failed > 0)) {
    await recordAudit({
      actor: opts.actor, action: 'storage.sweep_orphans', targetType: 'system', reason: opts.reason ?? 'varredura agendada',
      detail: { deleted, failed, orphanBytes: result.orphanBytes, missingFiles }, requestId: opts.requestId,
    }).catch((err) => log.error('sweep_orphans', err));
  }
  return result;
}

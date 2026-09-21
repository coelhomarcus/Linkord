import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { describe, it } from 'node:test';

// The migration rehearsal is itself a real-Postgres scenario (legacy data →
// gate → repair → head, interrupted migration, empty database). Running it here
// makes `test:integration` the single place that proves "migrations from empty
// and over legacy" (docs/plano-rede-social.md §14.1). It builds its own
// throwaway databases next to the one this suite runs in.

describe('ensaio de migracao', () => {
  it('passa inteiro: legado → portao → reparo → topo, migracao interrompida e banco vazio', async () => {
    const script = path.join(import.meta.dirname, '..', '..', 'src', 'scripts', 'rehearseMigration.ts');
    const base = process.env.TEST_DATABASE_BASE_URL;
    assert.ok(base, 'TEST_DATABASE_BASE_URL ausente (rode com npm run test:integration)');
    const output = await new Promise<{ code: number; stdout: string }>((resolve) => {
      let stdout = '';
      const child = spawn(process.execPath, ['--import', 'tsx', script, '--json'], { env: { ...process.env, DATABASE_URL: base }, stdio: ['ignore', 'pipe', 'inherit'] });
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.on('exit', (code) => resolve({ code: code ?? 1, stdout }));
    });
    const report = JSON.parse(output.stdout) as { ok: boolean; steps: { name: string; ok: boolean; detail?: string }[] };
    const failed = report.steps.filter((s) => !s.ok).map((s) => s.name);
    assert.deepEqual(failed, []);
    assert.equal(report.ok, true);
    assert.equal(output.code, 0);
    assert.ok(report.steps.length >= 20);
  });
});

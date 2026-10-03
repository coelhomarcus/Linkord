import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { ERROR_REGISTRY, errorBody } from '../../src/http/errors.js';

const SRC = path.resolve(import.meta.dirname, '../../src');
const WEB_CODES = path.resolve(import.meta.dirname, '../../../web/src/shared/api/errorCodes.ts');

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? sourceFiles(full) : full.endsWith('.ts') ? [full] : [];
  });
}

const files = sourceFiles(SRC).filter((f) => !f.endsWith(path.join('http', 'errors.ts')));
const sources = files.map((f) => ({ file: path.relative(SRC, f), text: fs.readFileSync(f, 'utf8') }));
const registry = ERROR_REGISTRY as Record<string, { statuses: readonly number[]; channel: string }>;

describe('error code registry', () => {
  it('every status used with sendError is among the code\'s statuses', () => {
    const problems: string[] = [];
    for (const { file, text } of sources) {
      for (const m of text.matchAll(/sendError\((?:reply|res), (\d+), '([^']+)'/g)) {
        const spec = registry[m[2]!];
        if (!spec) problems.push(`${file}: code not in registry '${m[2]}'`);
        else if (!spec.statuses.includes(Number(m[1]))) problems.push(`${file}: ${m[2]} with status ${m[1]} (registry: ${spec.statuses.join('/')})`);
      }
      for (const m of text.matchAll(/sendJson\(reply, (\d+), errorBody\('([^']+)'/g)) {
        const spec = registry[m[2]!];
        if (!spec || !spec.statuses.includes(Number(m[1]))) problems.push(`${file}: errorBody ${m[2]} with status ${m[1]}`);
      }
    }
    assert.deepEqual(problems, []);
  });

  it('no dead code: every registry code appears somewhere in the server', () => {
    const dead = Object.keys(registry).filter((code) => !sources.some(({ text }) => text.includes(`'${code}'`) || text.includes(`"${code}"`)));
    assert.deepEqual(dead, []);
  });

  it('socket-only codes have no HTTP status; HTTP ones do', () => {
    for (const [code, spec] of Object.entries(registry)) {
      if (spec.channel === 'socket') assert.equal(spec.statuses.length, 0, code);
      else assert.ok(spec.statuses.length > 0, code);
    }
  });

  it('every code the client knows about exists in the server registry', () => {
    const client = [...fs.readFileSync(WEB_CODES, 'utf8').matchAll(/^\s+(?:'[^']+'|\w+): '([^']+)',/gm)].map((m) => m[1]!);
    assert.ok(client.length > 10, 'the client extraction should find the codes');
    assert.deepEqual(client.filter((code) => !(code in registry)), []);
  });

  it('errorBody carries extra fields without inventing a code', () => {
    assert.deepEqual(errorBody('cooldown', 'wait', { retryAfter: 'x' }), { error: { code: 'cooldown', message: 'wait', retryAfter: 'x' } });
  });
});

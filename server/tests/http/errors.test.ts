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

describe('registro de codigos de erro', () => {
  it('todo status usado com sendError esta entre os status do codigo', () => {
    const problems: string[] = [];
    for (const { file, text } of sources) {
      for (const m of text.matchAll(/sendError\((?:reply|res), (\d+), '([^']+)'/g)) {
        const spec = registry[m[2]!];
        if (!spec) problems.push(`${file}: codigo fora do registro '${m[2]}'`);
        else if (!spec.statuses.includes(Number(m[1]))) problems.push(`${file}: ${m[2]} com status ${m[1]} (registro: ${spec.statuses.join('/')})`);
      }
      for (const m of text.matchAll(/sendJson\(reply, (\d+), errorBody\('([^']+)'/g)) {
        const spec = registry[m[2]!];
        if (!spec || !spec.statuses.includes(Number(m[1]))) problems.push(`${file}: errorBody ${m[2]} com status ${m[1]}`);
      }
    }
    assert.deepEqual(problems, []);
  });

  it('nenhum codigo morto: todo codigo do registro aparece em algum lugar do servidor', () => {
    const dead = Object.keys(registry).filter((code) => !sources.some(({ text }) => text.includes(`'${code}'`) || text.includes(`"${code}"`)));
    assert.deepEqual(dead, []);
  });

  it('codigos so de socket nao tem status HTTP; os de HTTP tem', () => {
    for (const [code, spec] of Object.entries(registry)) {
      if (spec.channel === 'socket') assert.equal(spec.statuses.length, 0, code);
      else assert.ok(spec.statuses.length > 0, code);
    }
  });

  it('todo codigo que o cliente conhece existe no registro do servidor', () => {
    const client = [...fs.readFileSync(WEB_CODES, 'utf8').matchAll(/^\s+(?:'[^']+'|\w+): '([^']+)',/gm)].map((m) => m[1]!);
    assert.ok(client.length > 10, 'a extracao do cliente deveria achar os codigos');
    assert.deepEqual(client.filter((code) => !(code in registry)), []);
  });

  it('errorBody carrega campos extras sem inventar codigo', () => {
    assert.deepEqual(errorBody('cooldown', 'espere', { retryAfter: 'x' }), { error: { code: 'cooldown', message: 'espere', retryAfter: 'x' } });
  });
});

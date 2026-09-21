import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseClientLog } from '../../../src/modules/logs/clientLogs.js';

describe('parseClientLog', () => {
  it('aceita warn/error com mensagem e corta o excesso', () => {
    const entry = parseClientLog({ level: 'error', message: 'm'.repeat(900), stack: 's'.repeat(9000), url: 'u'.repeat(900), userAgent: 'a'.repeat(900) })!;
    assert.equal(entry.level, 'error');
    assert.ok(entry.message.length <= 501);
    assert.ok(entry.stack!.length <= 4001);
    assert.ok(entry.url!.length <= 301);
    assert.ok(entry.userAgent!.length <= 201);
  });

  it('recusa nivel de fora (debug/info), sem mensagem ou lixo', () => {
    assert.equal(parseClientLog({ level: 'info', message: 'x' }), null);
    assert.equal(parseClientLog({ level: 'debug', message: 'x' }), null);
    assert.equal(parseClientLog({ level: 'error' }), null);
    assert.equal(parseClientLog({ level: 'error', message: '' }), null);
    assert.equal(parseClientLog({ level: 'error', message: 123 }), null);
  });

  it('mantem so os ultimos 5 breadcrumbs, cortados', () => {
    const entry = parseClientLog({ level: 'warn', message: 'x', breadcrumbs: Array.from({ length: 9 }, (_, i) => `${i}${'z'.repeat(400)}`) })!;
    assert.equal(entry.breadcrumbs!.length, 5);
    assert.ok(entry.breadcrumbs![0]!.startsWith('4'));
    assert.ok(entry.breadcrumbs!.every((b) => b.length <= 201));
  });

  it('context so entra se for objeto pequeno', () => {
    assert.deepEqual(parseClientLog({ level: 'warn', message: 'x', context: { a: 1 } })!.context, { a: 1 });
    assert.equal(parseClientLog({ level: 'warn', message: 'x', context: [1] })!.context, undefined);
    assert.equal(parseClientLog({ level: 'warn', message: 'x', context: { big: 'z'.repeat(2000) } })!.context, undefined);
  });
});

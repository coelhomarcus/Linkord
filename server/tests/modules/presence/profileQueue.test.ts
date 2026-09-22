import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runSerialized } from '../../../src/modules/presence/profileQueue.js';

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('runSerialized', () => {
  it('duas tarefas da MESMA chave rodam em ordem, a segunda so comeca apos a primeira terminar', async () => {
    const order: string[] = [];
    const first = deferred<void>();
    const p1 = runSerialized('u1', async () => { order.push('1 start'); await first.promise; order.push('1 end'); });
    const p2 = runSerialized('u1', async () => { order.push('2 start'); });
    // the second task must not have started yet — it is queued behind the first
    await Promise.resolve(); await Promise.resolve();
    assert.deepEqual(order, ['1 start']);
    first.resolve();
    await Promise.all([p1, p2]);
    assert.deepEqual(order, ['1 start', '1 end', '2 start']);
  });

  it('tarefas de chaves diferentes rodam em paralelo, uma nao espera a outra', async () => {
    const order: string[] = [];
    const blockA = deferred<void>();
    const pA = runSerialized('a', async () => { order.push('a start'); await blockA.promise; order.push('a end'); });
    const pB = runSerialized('b', async () => { order.push('b start'); order.push('b end'); });
    await pB; // 'b' finishes without waiting on 'a', which is still blocked
    assert.deepEqual(order, ['a start', 'b start', 'b end']);
    blockA.resolve();
    await pA;
  });

  it('uma tarefa que rejeita nao trava a fila: a proxima da mesma chave ainda roda', async () => {
    const order: string[] = [];
    await assert.rejects(runSerialized('u2', async () => { order.push('fails'); throw new Error('boom'); }));
    await runSerialized('u2', async () => { order.push('runs anyway'); });
    assert.deepEqual(order, ['fails', 'runs anyway']);
  });

  it('devolve o valor (ou o erro) da propria tarefa, nao da fila', async () => {
    assert.equal(await runSerialized('u3', async () => 42), 42);
    await assert.rejects(runSerialized('u3', async () => { throw new Error('x'); }), /x/);
  });

  it('muitas tarefas da mesma chave preservam a ordem de chegada', async () => {
    const order: number[] = [];
    await Promise.all([1, 2, 3, 4, 5].map((n) => runSerialized('u4', async () => { order.push(n); })));
    assert.deepEqual(order, [1, 2, 3, 4, 5]);
  });
});

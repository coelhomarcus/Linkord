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
  it('two tasks for the SAME key run in order, the second only starts after the first finishes', async () => {
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

  it('tasks for different keys run in parallel, one does not wait for the other', async () => {
    const order: string[] = [];
    const blockA = deferred<void>();
    const pA = runSerialized('a', async () => { order.push('a start'); await blockA.promise; order.push('a end'); });
    const pB = runSerialized('b', async () => { order.push('b start'); order.push('b end'); });
    await pB; // 'b' finishes without waiting on 'a', which is still blocked
    assert.deepEqual(order, ['a start', 'b start', 'b end']);
    blockA.resolve();
    await pA;
  });

  it('a rejecting task does not lock the queue: the next task for the same key still runs', async () => {
    const order: string[] = [];
    await assert.rejects(runSerialized('u2', async () => { order.push('fails'); throw new Error('boom'); }));
    await runSerialized('u2', async () => { order.push('runs anyway'); });
    assert.deepEqual(order, ['fails', 'runs anyway']);
  });

  it('returns the value (or error) of the task itself, not the queue', async () => {
    assert.equal(await runSerialized('u3', async () => 42), 42);
    await assert.rejects(runSerialized('u3', async () => { throw new Error('x'); }), /x/);
  });

  it('many tasks for the same key preserve arrival order', async () => {
    const order: number[] = [];
    await Promise.all([1, 2, 3, 4, 5].map((n) => runSerialized('u4', async () => { order.push(n); })));
    assert.deepEqual(order, [1, 2, 3, 4, 5]);
  });
});

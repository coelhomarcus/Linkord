import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { OUTBOX_MAX_ATTEMPTS, daysAgo, isOutboxFailed, nextOutboxState } from '../../../src/modules/notifications/notificationsPolicy.js';

describe('nextOutboxState', () => {
  it('entrega bem-sucedida marca processado e conta a tentativa', () => {
    assert.deepEqual(nextOutboxState(0, true), { processed: true, attempts: 1 });
  });

  it('falha so incrementa e o evento continua pendente', () => {
    assert.deepEqual(nextOutboxState(2, false), { processed: false, attempts: 3 });
  });

  it('esgotadas as tentativas, o evento fica como falho (nao processado, nao repetido)', () => {
    let state = { processed: false, attempts: 0 };
    for (let i = 0; i < OUTBOX_MAX_ATTEMPTS; i++) state = nextOutboxState(state.attempts, false);
    assert.equal(isOutboxFailed(state), true);
    assert.equal(isOutboxFailed({ processed: false, attempts: OUTBOX_MAX_ATTEMPTS - 1 }), false);
    assert.equal(isOutboxFailed({ processed: true, attempts: OUTBOX_MAX_ATTEMPTS }), false);
  });
});

describe('daysAgo', () => {
  it('recua o numero exato de dias', () => {
    const now = new Date('2026-09-30T12:00:00Z');
    assert.equal(daysAgo(30, now).toISOString(), '2026-08-31T12:00:00.000Z');
  });
});

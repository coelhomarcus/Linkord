import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { OUTBOX_MAX_ATTEMPTS, daysAgo, isOutboxFailed, nextOutboxState } from '../../../src/modules/notifications/notificationsPolicy.js';

describe('nextOutboxState', () => {
  it('successful delivery marks processed and counts the attempt', () => {
    assert.deepEqual(nextOutboxState(0, true), { processed: true, attempts: 1 });
  });

  it('failure only increments and the event stays pending', () => {
    assert.deepEqual(nextOutboxState(2, false), { processed: false, attempts: 3 });
  });

  it('once attempts are exhausted, the event ends up failed (not processed, not repeated)', () => {
    let state = { processed: false, attempts: 0 };
    for (let i = 0; i < OUTBOX_MAX_ATTEMPTS; i++) state = nextOutboxState(state.attempts, false);
    assert.equal(isOutboxFailed(state), true);
    assert.equal(isOutboxFailed({ processed: false, attempts: OUTBOX_MAX_ATTEMPTS - 1 }), false);
    assert.equal(isOutboxFailed({ processed: true, attempts: OUTBOX_MAX_ATTEMPTS }), false);
  });
});

describe('daysAgo', () => {
  it('goes back the exact number of days', () => {
    const now = new Date('2026-09-30T12:00:00Z');
    assert.equal(daysAgo(30, now).toISOString(), '2026-08-31T12:00:00.000Z');
  });
});

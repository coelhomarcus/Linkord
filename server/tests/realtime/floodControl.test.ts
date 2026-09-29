import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { allow, retryAfterMs } from '../../src/realtime/floodControl.js';

describe('retryAfterMs', () => {
  test('within the limit: can act right away', () => {
    const rule = { windowMs: 60_000, max: 2 };
    allow('rt-a', rule);
    assert.equal(retryAfterMs('rt-a', rule), 0);
  });

  test('at the limit: waits until the oldest action in the window drops off', () => {
    const rule = { windowMs: 60_000, max: 2 };
    allow('rt-b', rule);
    allow('rt-b', rule);
    assert.equal(allow('rt-b', rule), false);
    const wait = retryAfterMs('rt-b', rule);
    assert.ok(wait > 59_000 && wait <= 60_000, String(wait));
  });
});

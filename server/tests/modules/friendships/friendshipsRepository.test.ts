import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isWithinCooldown } from '../../../src/modules/friendships/friendshipsRepository.js';

describe('isWithinCooldown', () => {
  it('a null retryAfter is never within cooldown', () => {
    assert.equal(isWithinCooldown(null), false);
  });

  it('a date in the future is within cooldown', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const retryAfter = new Date('2026-01-02T00:00:00Z');
    assert.equal(isWithinCooldown(retryAfter, now), true);
  });

  it('a date in the past is no longer within cooldown', () => {
    const now = new Date('2026-01-02T00:00:00Z');
    const retryAfter = new Date('2026-01-01T00:00:00Z');
    assert.equal(isWithinCooldown(retryAfter, now), false);
  });
});

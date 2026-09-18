import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isWithinCooldown } from '../../../src/modules/friendships/friendshipsRepository.js';

describe('isWithinCooldown', () => {
  it('null retryAfter nunca está em cooldown', () => {
    assert.equal(isWithinCooldown(null), false);
  });

  it('data no futuro está em cooldown', () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const retryAfter = new Date('2026-01-02T00:00:00Z');
    assert.equal(isWithinCooldown(retryAfter, now), true);
  });

  it('data no passado não está mais em cooldown', () => {
    const now = new Date('2026-01-02T00:00:00Z');
    const retryAfter = new Date('2026-01-01T00:00:00Z');
    assert.equal(isWithinCooldown(retryAfter, now), false);
  });
});

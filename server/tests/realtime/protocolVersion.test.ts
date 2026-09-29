import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MIN_PROTOCOL_VERSION, PROTOCOL_VERSION, isClientCompatible } from '../../src/realtime/protocolVersion.js';

describe('isClientCompatible', () => {
  it('the current version and the minimum one pass', () => {
    assert.equal(isClientCompatible(PROTOCOL_VERSION), true);
    assert.equal(isClientCompatible(MIN_PROTOCOL_VERSION), true);
    assert.equal(isClientCompatible(PROTOCOL_VERSION + 1), true);
  });

  it('an old client (no version, or below the minimum) is refused', () => {
    assert.equal(isClientCompatible(undefined), false);
    assert.equal(isClientCompatible(null), false);
    assert.equal(isClientCompatible(MIN_PROTOCOL_VERSION - 1), false);
    assert.equal(isClientCompatible(0), false);
  });

  it('garbage does not pass (string, decimal, NaN)', () => {
    assert.equal(isClientCompatible('2'), false);
    assert.equal(isClientCompatible(2.5), false);
    assert.equal(isClientCompatible(Number.NaN), false);
    assert.equal(isClientCompatible({}), false);
  });
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MIN_PROTOCOL_VERSION, PROTOCOL_VERSION, isClientCompatible } from '../../src/realtime/protocolVersion.js';

describe('isClientCompatible', () => {
  it('a versao atual e a minima passam', () => {
    assert.equal(isClientCompatible(PROTOCOL_VERSION), true);
    assert.equal(isClientCompatible(MIN_PROTOCOL_VERSION), true);
    assert.equal(isClientCompatible(PROTOCOL_VERSION + 1), true);
  });

  it('cliente antigo (sem versao ou abaixo da minima) e recusado', () => {
    assert.equal(isClientCompatible(undefined), false);
    assert.equal(isClientCompatible(null), false);
    assert.equal(isClientCompatible(MIN_PROTOCOL_VERSION - 1), false);
    assert.equal(isClientCompatible(0), false);
  });

  it('lixo nao passa (string, decimal, NaN)', () => {
    assert.equal(isClientCompatible('2'), false);
    assert.equal(isClientCompatible(2.5), false);
    assert.equal(isClientCompatible(Number.NaN), false);
    assert.equal(isClientCompatible({}), false);
  });
});

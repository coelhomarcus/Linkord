import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cachePolicyFor } from '../../../src/modules/attachments/attachmentServing.js';

const chat = { id: 'abc123', messageId: 7 };
const avatar = { id: 'def456', messageId: null };

describe('cachePolicyFor', () => {
  it('anexo de chat revalida sempre (private, no-cache) com ETag do id', () => {
    const policy = cachePolicyFor(chat, undefined);
    assert.equal(policy.cacheControl, 'private, no-cache');
    assert.equal(policy.etag, '"abc123"');
    assert.equal(policy.notModified, false);
  });

  it('If-None-Match igual ao ETag vira 304 (so depois do check de acesso, feito pelo chamador)', () => {
    assert.equal(cachePolicyFor(chat, '"abc123"').notModified, true);
    assert.equal(cachePolicyFor(chat, 'W/"abc123"').notModified, true);
    assert.equal(cachePolicyFor(chat, '"x", "abc123"').notModified, true);
    assert.equal(cachePolicyFor(chat, '"outro"').notModified, false);
  });

  it('avatar/banner (publicos) mantem cache longo e nunca respondem 304', () => {
    const policy = cachePolicyFor(avatar, '"def456"');
    assert.match(policy.cacheControl, /max-age=31536000/);
    assert.equal(policy.etag, null);
    assert.equal(policy.notModified, false);
  });
});

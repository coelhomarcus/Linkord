import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { shouldAnnounceCall } from '../../../src/integrations/discord/discordWebhook.js';

describe('shouldAnnounceCall', () => {
  it('sem conversa configurada nada e anunciado (padrao seguro)', () => {
    assert.equal(shouldAnnounceCall('conv-1', ''), false);
    assert.equal(shouldAnnounceCall(null, ''), false);
  });

  it('so a conversa configurada e anunciada; DMs e outros grupos nao', () => {
    assert.equal(shouldAnnounceCall('conv-1', 'conv-1'), true);
    assert.equal(shouldAnnounceCall('dm-9', 'conv-1'), false);
  });

  it('quem nao esta em chamada nao gera anuncio', () => {
    assert.equal(shouldAnnounceCall(null, 'conv-1'), false);
  });
});

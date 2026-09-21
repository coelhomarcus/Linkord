import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { config } from '../../../src/config/env.js';
import { effectiveStatus } from '../../../src/modules/conversations/invitationCards.js';
import { normalizeInviteeIds, resendAvailableAt } from '../../../src/modules/conversations/invitationsRepository.js';

const NOW = new Date('2026-09-20T12:00:00Z');
const past = new Date('2026-09-20T11:59:59Z');
const future = new Date('2026-09-20T12:00:01Z');

describe('effectiveStatus', () => {
  it('pendente vencido le como expirado, sem esperar o varredor', () => {
    assert.equal(effectiveStatus('pending', past, NOW), 'expired');
  });

  it('o prazo exato ja conta como expirado (limite exclusivo)', () => {
    assert.equal(effectiveStatus('pending', NOW, NOW), 'expired');
  });

  it('pendente dentro do prazo continua pendente', () => {
    assert.equal(effectiveStatus('pending', future, NOW), 'pending');
  });

  it('estados finais nunca mudam por causa do relogio', () => {
    for (const status of ['accepted', 'declined', 'revoked', 'expired'] as const) {
      assert.equal(effectiveStatus(status, past, NOW), status);
    }
  });
});

describe('resendAvailableAt (cooldown depois de uma recusa)', () => {
  it('logo depois de recusar ainda nao pode reenviar', () => {
    const at = resendAvailableAt(new Date(NOW.getTime() - 60_000), NOW);
    assert.ok(at);
    assert.equal(at.getTime(), NOW.getTime() - 60_000 + config.GROUP_INVITATION_RESEND_COOLDOWN_MS);
  });

  it('passado o cooldown pode reenviar', () => {
    const old = new Date(NOW.getTime() - config.GROUP_INVITATION_RESEND_COOLDOWN_MS - 1);
    assert.equal(resendAvailableAt(old, NOW), null);
  });

  it('sem data de resposta nao ha cooldown', () => {
    assert.equal(resendAvailableAt(null, NOW), null);
  });
});

describe('normalizeInviteeIds', () => {
  it('deduplica, ignora lixo e nunca convida a si mesmo', () => {
    const { ids, tooMany } = normalizeInviteeIds(['a', 'a', 'b', '', 7, null, 'me', { x: 1 }], 'me');
    assert.deepEqual(ids, ['a', 'b']);
    assert.equal(tooMany, false);
  });

  it('entrada que nao e lista vira lista vazia', () => {
    assert.deepEqual(normalizeInviteeIds('a,b', 'me'), { ids: [], tooMany: false });
    assert.deepEqual(normalizeInviteeIds(undefined, 'me'), { ids: [], tooMany: false });
  });

  it('lote acima do limite do servidor e sinalizado, nao truncado em silencio', () => {
    const many = Array.from({ length: config.MAX_INVITEES_PER_REQUEST + 1 }, (_, i) => `u${i}`);
    const result = normalizeInviteeIds(many, 'me');
    assert.equal(result.tooMany, true);
    assert.equal(result.ids.length, many.length);
    assert.equal(normalizeInviteeIds(many.slice(1), 'me').tooMany, false);
  });
});

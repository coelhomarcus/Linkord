import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MAX_REPORT_DETAILS, MAX_SNAPSHOT_TEXT, buildMessageSnapshot, isActionAllowedFor, isClosed, parseReportInput, resolutionFor,
} from '../../../src/modules/reports/reportsPolicy.js';

describe('parseReportInput', () => {
  const ok = { targetType: 'user', targetId: 'abc', category: 'spam', details: '  muito spam  ' };

  it('aceita uma denuncia valida e apara os detalhes', () => {
    assert.deepEqual(parseReportInput(ok), { targetType: 'user', targetId: 'abc', category: 'spam', details: 'muito spam' });
  });

  it('detalhes sao opcionais', () => {
    assert.equal(parseReportInput({ ...ok, details: undefined })?.details, '');
  });

  it('recusa tipo, categoria e alvo invalidos', () => {
    assert.equal(parseReportInput({ ...ok, targetType: 'server' }), null);
    assert.equal(parseReportInput({ ...ok, category: 'nope' }), null);
    assert.equal(parseReportInput({ ...ok, category: 123 }), null);
    assert.equal(parseReportInput({ ...ok, targetId: '' }), null);
    assert.equal(parseReportInput({ ...ok, targetId: 'x'.repeat(65) }), null);
  });

  it('recusa detalhes acima do limite', () => {
    assert.equal(parseReportInput({ ...ok, details: 'x'.repeat(MAX_REPORT_DETAILS + 1) }), null);
    assert.notEqual(parseReportInput({ ...ok, details: 'x'.repeat(MAX_REPORT_DETAILS) }), null);
  });
});

describe('buildMessageSnapshot', () => {
  const base = { authorId: 'u1', authorUsername: 'ana', conversationId: 'c1', conversationTitle: 'Grupo', createdAt: new Date('2026-01-01T00:00:00Z') };

  it('guarda so o necessario', () => {
    const snap = buildMessageSnapshot({ ...base, text: 'oi' });
    assert.deepEqual(Object.keys(snap).sort(), ['authorId', 'authorUsername', 'conversationId', 'conversationTitle', 'sentAt', 'text', 'truncated']);
    assert.equal(snap.truncated, false);
  });

  it('corta o texto no limite e marca como truncado', () => {
    const snap = buildMessageSnapshot({ ...base, text: 'x'.repeat(MAX_SNAPSHOT_TEXT + 50) });
    assert.equal((snap.text as string).length, MAX_SNAPSHOT_TEXT);
    assert.equal(snap.truncated, true);
  });
});

describe('acoes de uma denuncia', () => {
  it('cada tipo so admite as acoes que fazem sentido', () => {
    assert.equal(isActionAllowedFor('user', 'suspend_user'), true);
    assert.equal(isActionAllowedFor('user', 'delete_message'), false);
    assert.equal(isActionAllowedFor('group', 'suspend_group'), true);
    assert.equal(isActionAllowedFor('group', 'suspend_user'), false);
    assert.equal(isActionAllowedFor('message', 'delete_message'), true);
    assert.equal(isActionAllowedFor('message', 'suspend_user'), true);
    assert.equal(isActionAllowedFor('message', 'suspend_group'), false);
  });

  it('a resolucao registrada acompanha a acao (sem acao = no_action)', () => {
    assert.equal(resolutionFor(null), 'no_action');
    assert.equal(resolutionFor('suspend_user'), 'user_suspended');
    assert.equal(resolutionFor('suspend_group'), 'group_suspended');
    assert.equal(resolutionFor('delete_message'), 'message_deleted');
  });

  it('resolvida e dispensada sao estados finais', () => {
    assert.equal(isClosed('resolved'), true);
    assert.equal(isClosed('dismissed'), true);
    assert.equal(isClosed('open'), false);
    assert.equal(isClosed('reviewing'), false);
  });
});

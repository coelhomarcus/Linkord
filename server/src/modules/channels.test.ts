import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { canDeleteChannel, isTextChannelType, sanitizeChannelName } from './channels.js';

describe('canDeleteChannel', () => {
  test('canal de texto sempre pode ser apagado, mesmo sendo o unico', () => {
    assert.equal(canDeleteChannel('text', 1), true);
    assert.equal(canDeleteChannel('text', 0), true);
  });

  test('canal de voz pode ser apagado se existir mais de um', () => {
    assert.equal(canDeleteChannel('voice', 2), true);
    assert.equal(canDeleteChannel('voice', 5), true);
  });

  test('NAO pode apagar o unico canal de voz restante — a sala nao pode ficar sem nenhum', () => {
    assert.equal(canDeleteChannel('voice', 1), false);
  });

  test('caso defensivo (contagem 0, nao deveria acontecer na pratica) tambem bloqueia', () => {
    assert.equal(canDeleteChannel('voice', 0), false);
  });
});

describe('sanitizeChannelName', () => {
  test('nome valido passa trimado', () => {
    assert.equal(sanitizeChannelName('  geral  '), 'geral');
  });

  test('nome vazio (so espacos) vira null', () => {
    assert.equal(sanitizeChannelName('   '), null);
    assert.equal(sanitizeChannelName(''), null);
    assert.equal(sanitizeChannelName(null), null);
    assert.equal(sanitizeChannelName(undefined), null);
  });

  test('corta em 60 caracteres', () => {
    const longName = 'a'.repeat(100);
    assert.equal(sanitizeChannelName(longName)?.length, 60);
  });
});

describe('isTextChannelType', () => {
  test('aceita somente canal de texto para chat, historico e anexos', () => {
    assert.equal(isTextChannelType('text'), true);
    assert.equal(isTextChannelType('voice'), false);
    assert.equal(isTextChannelType('qualquer-outro'), false);
    assert.equal(isTextChannelType(null), false);
    assert.equal(isTextChannelType(undefined), false);
  });
});

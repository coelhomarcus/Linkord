import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeAvatar, sanitizeBanner, sanitizeAvatarColor, sanitizeDisplayName, sanitizeBio, sanitizeProfileLinks,
} from '../../../src/modules/profile/sanitize.js';

describe('sanitizeAvatar / sanitizeBanner', () => {
  test('aceita URL http(s) externa', () => {
    assert.equal(sanitizeAvatar('https://example.com/a.png'), 'https://example.com/a.png');
    assert.equal(sanitizeBanner('http://example.com/b.png'), 'http://example.com/b.png');
  });

  test('aceita upload proprio (/uploads/<32 hex>)', () => {
    const id = 'a'.repeat(32);
    assert.equal(sanitizeAvatar(`/uploads/${id}`), `/uploads/${id}`);
  });

  test('rejeita valor que nao e URL nem upload proprio', () => {
    assert.equal(sanitizeAvatar('nao e uma url'), '');
    assert.equal(sanitizeAvatar('/uploads/curto'), '');
    assert.equal(sanitizeAvatar(null), '');
    assert.equal(sanitizeAvatar(undefined), '');
  });

  test('corta no limite de tamanho antes de validar', () => {
    const long = 'https://example.com/' + 'a'.repeat(600);
    assert.equal(sanitizeAvatar(long).length, 500);
  });
});

describe('sanitizeAvatarColor', () => {
  test('aceita uma das cores predefinidas', () => {
    assert.equal(sanitizeAvatarColor('green'), 'green');
  });

  test('aceita hex de 6 digitos, normalizado pra minusculo', () => {
    assert.equal(sanitizeAvatarColor('#ABCDEF'), '#abcdef');
  });

  test('cai no padrao (blurple) pra qualquer outro valor', () => {
    assert.equal(sanitizeAvatarColor('nao-existe'), 'blurple');
    assert.equal(sanitizeAvatarColor('#fff'), 'blurple'); // 3-digit hex doesn't count
    assert.equal(sanitizeAvatarColor(null), 'blurple');
  });
});

describe('sanitizeDisplayName', () => {
  test('remove quebra de linha/tab e colapsa pra uma linha', () => {
    assert.equal(sanitizeDisplayName('Foo\nBar\tBaz'), 'Foo Bar Baz');
  });

  test('apara espaco e corta no limite (32)', () => {
    assert.equal(sanitizeDisplayName('  ola  '), 'ola');
    assert.equal(sanitizeDisplayName('a'.repeat(50)).length, 32);
  });
});

describe('sanitizeBio', () => {
  test('normaliza CRLF pra LF e preserva quebras de linha', () => {
    assert.equal(sanitizeBio('linha1\r\nlinha2'), 'linha1\nlinha2');
  });

  test('apara espaco e corta no limite (300)', () => {
    assert.equal(sanitizeBio('  ola  '), 'ola');
    assert.equal(sanitizeBio('a'.repeat(400)).length, 300);
  });
});

describe('sanitizeProfileLinks', () => {
  test('mantem so URLs http(s) validas, na ordem', () => {
    assert.deepEqual(
      sanitizeProfileLinks(['https://a.com', 'nao e url', 'http://b.com']),
      ['https://a.com', 'http://b.com'],
    );
  });

  test('remove duplicata (case-insensitive)', () => {
    assert.deepEqual(
      sanitizeProfileLinks(['https://a.com', 'HTTPS://A.COM']),
      ['https://a.com'],
    );
  });

  test('limita a MAX_PROFILE_LINKS (8) e ignora valor que nao e array', () => {
    const many = Array.from({ length: 12 }, (_, i) => `https://site${i}.com`);
    assert.equal(sanitizeProfileLinks(many).length, 8);
    assert.deepEqual(sanitizeProfileLinks('nao e array'), []);
    assert.deepEqual(sanitizeProfileLinks(undefined), []);
  });
});

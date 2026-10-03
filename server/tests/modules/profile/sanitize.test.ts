import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeAvatar, sanitizeBanner, sanitizeAvatarColor, sanitizeDisplayName, sanitizeBio, sanitizeProfileLinks,
} from '../../../src/modules/profile/sanitize.js';

describe('sanitizeAvatar / sanitizeBanner', () => {
  test('accepts an external http(s) URL', () => {
    assert.equal(sanitizeAvatar('https://example.com/a.png'), 'https://example.com/a.png');
    assert.equal(sanitizeBanner('http://example.com/b.png'), 'http://example.com/b.png');
  });

  test('accepts a self upload (/uploads/<32 hex>)', () => {
    const id = 'a'.repeat(32);
    assert.equal(sanitizeAvatar(`/uploads/${id}`), `/uploads/${id}`);
  });

  test('rejects a value that is neither a URL nor a self upload', () => {
    assert.equal(sanitizeAvatar('not a url'), '');
    assert.equal(sanitizeAvatar('/uploads/short'), '');
    assert.equal(sanitizeAvatar(null), '');
    assert.equal(sanitizeAvatar(undefined), '');
  });

  test('truncates to the size limit before validating', () => {
    const long = 'https://example.com/' + 'a'.repeat(600);
    assert.equal(sanitizeAvatar(long).length, 500);
  });
});

describe('sanitizeAvatarColor', () => {
  test('accepts one of the predefined colors', () => {
    assert.equal(sanitizeAvatarColor('green'), 'green');
  });

  test('accepts a 6-digit hex, normalized to lowercase', () => {
    assert.equal(sanitizeAvatarColor('#ABCDEF'), '#abcdef');
  });

  test('falls back to the default (blurple) for any other value', () => {
    assert.equal(sanitizeAvatarColor('does-not-exist'), 'blurple');
    assert.equal(sanitizeAvatarColor('#fff'), 'blurple'); // 3-digit hex doesn't count
    assert.equal(sanitizeAvatarColor(null), 'blurple');
  });
});

describe('sanitizeDisplayName', () => {
  test('removes newlines/tabs and collapses to one line', () => {
    assert.equal(sanitizeDisplayName('Foo\nBar\tBaz'), 'Foo Bar Baz');
  });

  test('trims whitespace and truncates to the limit (32)', () => {
    assert.equal(sanitizeDisplayName('  ola  '), 'ola');
    assert.equal(sanitizeDisplayName('a'.repeat(50)).length, 32);
  });
});

describe('sanitizeBio', () => {
  test('normalizes CRLF to LF and preserves line breaks', () => {
    assert.equal(sanitizeBio('linha1\r\nlinha2'), 'linha1\nlinha2');
  });

  test('trims whitespace and truncates to the limit (300)', () => {
    assert.equal(sanitizeBio('  ola  '), 'ola');
    assert.equal(sanitizeBio('a'.repeat(400)).length, 300);
  });
});

describe('sanitizeProfileLinks', () => {
  test('keeps only valid http(s) URLs, in order', () => {
    assert.deepEqual(
      sanitizeProfileLinks(['https://a.com', 'not a url', 'http://b.com']),
      ['https://a.com', 'http://b.com'],
    );
  });

  test('removes duplicates (case-insensitive)', () => {
    assert.deepEqual(
      sanitizeProfileLinks(['https://a.com', 'HTTPS://A.COM']),
      ['https://a.com'],
    );
  });

  test('limits to MAX_PROFILE_LINKS (8) and ignores a non-array value', () => {
    const many = Array.from({ length: 12 }, (_, i) => `https://site${i}.com`);
    assert.equal(sanitizeProfileLinks(many).length, 8);
    assert.deepEqual(sanitizeProfileLinks('not an array'), []);
    assert.deepEqual(sanitizeProfileLinks(undefined), []);
  });
});

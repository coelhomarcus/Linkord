import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  FixedWindowRateLimiter,
  avatarStorageBelongsTo,
  avatarStorageName,
  contentDispositionFor,
  expectedChunkLength,
  ifRangeMatches,
  parseByteRange,
  sanitizeFileName,
  uploadEtag,
} from './attachments.js';

describe('expectedChunkLength', () => {
  const manifest = { totalSize: 20_000_000, chunkSize: 8_000_000, totalChunks: 3 } as Parameters<typeof expectedChunkLength>[0];

  test('todo chunk antes do ultimo tem exatamente chunkSize', () => {
    assert.equal(expectedChunkLength(manifest, 0), 8_000_000);
    assert.equal(expectedChunkLength(manifest, 1), 8_000_000);
  });

  test('o ULTIMO chunk e o resto (totalSize nem sempre e multiplo exato de chunkSize)', () => {
    assert.equal(expectedChunkLength(manifest, 2), 20_000_000 - 8_000_000 * 2); // 4_000_000
  });

  test('arquivo que cabe num unico chunk: esse unico chunk e o tamanho total', () => {
    const single = { totalSize: 500, chunkSize: 8_000_000, totalChunks: 1 } as Parameters<typeof expectedChunkLength>[0];
    assert.equal(expectedChunkLength(single, 0), 500);
  });
});

describe('contentDispositionFor', () => {
  test('nome simples (so ASCII) fica identico nos dois formatos', () => {
    const header = contentDispositionFor('inline', 'foto.png');
    assert.equal(header, `inline; filename="foto.png"; filename*=UTF-8''foto.png`);
  });

  test('acentuacao vira _ no fallback ASCII, mas aparece certa no filename* (UTF-8)', () => {
    const header = contentDispositionFor('attachment', 'relatório.pdf');
    assert.match(header, /filename="relat_rio\.pdf"/);
    assert.match(header, /filename\*=UTF-8''relat%C3%B3rio\.pdf/);
  });

  test('aspas duplas no nome viram aspas simples no fallback ASCII (nunca quebram o header)', () => {
    const header = contentDispositionFor('inline', 'nome "esquisito".txt');
    assert.match(header, /filename="nome 'esquisito'\.txt"/);
  });

  test('kind (inline/attachment) aparece no inicio do header', () => {
    assert.match(contentDispositionFor('inline', 'a.png'), /^inline;/);
    assert.match(contentDispositionFor('attachment', 'a.png'), /^attachment;/);
  });
});

describe('sanitizeFileName', () => {
  test('nome vazio/ausente cai no fallback "arquivo"', () => {
    assert.equal(sanitizeFileName(''), 'arquivo');
    assert.equal(sanitizeFileName(null), 'arquivo');
    assert.equal(sanitizeFileName(undefined), 'arquivo');
  });

  test('quebra de linha e barra viram _ (nunca vazam pro header Content-Disposition)', () => {
    assert.equal(sanitizeFileName('nome\r\ncom\\quebras/e/barras'), 'nome__com_quebras_e_barras');
  });

  test('corta em 200 caracteres', () => {
    const longName = 'a'.repeat(300);
    assert.equal(sanitizeFileName(longName).length, 200);
  });

  test('espacos nas pontas sao removidos', () => {
    assert.equal(sanitizeFileName('  nome.txt  '), 'nome.txt');
  });
});

describe('parseByteRange', () => {
  test('interpreta inicio/fim, range aberto e sufixo', () => {
    assert.deepEqual(parseByteRange('bytes=10-19', 100), { start: 10, end: 19 });
    assert.deepEqual(parseByteRange('bytes=90-', 100), { start: 90, end: 99 });
    assert.deepEqual(parseByteRange('bytes=-10', 100), { start: 90, end: 99 });
  });

  test('limita fim ao EOF e sufixo maior ao arquivo inteiro', () => {
    assert.deepEqual(parseByteRange('bytes=90-999', 100), { start: 90, end: 99 });
    assert.deepEqual(parseByteRange('bytes=-999', 100), { start: 0, end: 99 });
  });

  test('rejeita ranges malformados, multiplos e impossiveis', () => {
    for (const value of ['items=0-1', 'bytes=', 'bytes=10-9', 'bytes=100-101', 'bytes=-0', 'bytes=0-1,4-5']) {
      assert.equal(parseByteRange(value, 100), null, value);
    }
  });
});

describe('ETag / If-Range', () => {
  const mtimeMs = Date.parse('2026-01-02T03:04:05.250Z');
  const etag = uploadEtag(1234, mtimeMs);

  test('aceita ETag forte igual e rejeita diferente/fraco', () => {
    assert.equal(ifRangeMatches(etag, etag, mtimeMs), true);
    assert.equal(ifRangeMatches('"outro"', etag, mtimeMs), false);
    assert.equal(ifRangeMatches(`W/${etag}`, etag, mtimeMs), false);
  });

  test('aceita data atual/nova e rejeita data antiga ou invalida', () => {
    assert.equal(ifRangeMatches(new Date(mtimeMs).toUTCString(), etag, mtimeMs), true);
    assert.equal(ifRangeMatches(new Date(mtimeMs + 60_000).toUTCString(), etag, mtimeMs), true);
    assert.equal(ifRangeMatches(new Date(mtimeMs - 60_000).toUTCString(), etag, mtimeMs), false);
    assert.equal(ifRangeMatches('nao-e-data', etag, mtimeMs), false);
  });
});

describe('FixedWindowRateLimiter', () => {
  test('aceita ate o limite e informa Retry-After depois', () => {
    const limiter = new FixedWindowRateLimiter(2, 10_000);
    assert.equal(limiter.consume('u', 1_000), null);
    assert.equal(limiter.consume('u', 2_000), null);
    assert.equal(limiter.consume('u', 3_000), 8);
    assert.equal(limiter.consume('u', 11_000), null);
  });

  test('usuarios possuem janelas independentes', () => {
    const limiter = new FixedWindowRateLimiter(1, 10_000);
    assert.equal(limiter.consume('a', 1_000), null);
    assert.equal(limiter.consume('b', 1_000), null);
    assert.equal(limiter.consume('a', 1_001), 10);
  });
});

describe('ownership de avatar', () => {
  test('nome de storage vincula exatamente ao dono', () => {
    const stored = avatarStorageName('user-1');
    assert.equal(avatarStorageBelongsTo(stored, 'user-1'), true);
    assert.equal(avatarStorageBelongsTo(stored, 'user-2'), false);
    assert.equal(avatarStorageBelongsTo('avatar', 'user-1'), false);
  });
});

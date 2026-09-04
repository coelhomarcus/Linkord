import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { expectedChunkLength, contentDispositionFor, sanitizeFileName } from './attachments.js';

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

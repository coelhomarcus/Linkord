import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { expectedChunkLength, contentDispositionFor, sanitizeFileName, extensionOf, isPreviewable, decodeUtf8Prefix } from './attachments.js';
import type { Attachment } from '../db/schema.js';

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

describe('extensionOf', () => {
  test('extrai a extensao em minusculo', () => {
    assert.equal(extensionOf('README.MD'), 'md');
    assert.equal(extensionOf('script.py'), 'py');
  });

  test('sem extensao retorna string vazia', () => {
    assert.equal(extensionOf('Dockerfile'), '');
  });

  test('nome com varios pontos usa so a ultima extensao', () => {
    assert.equal(extensionOf('arquivo.tar.gz'), 'gz');
  });
});

describe('isPreviewable', () => {
  function fakeAttachment(overrides: Partial<Attachment> = {}): Attachment {
    return {
      id: 'a'.repeat(32), messageId: 1, fileName: 'notas.md', mimeType: 'text/markdown',
      size: 100, createdAt: new Date(), thumbId: null, isThumbnail: false,
      ...overrides,
    };
  }

  test('extensao na allowlist e previsualizavel mesmo com mime generico', () => {
    assert.equal(isPreviewable(fakeAttachment({ fileName: 'script.py', mimeType: 'application/octet-stream' })), true);
  });

  test('mime text/* e previsualizavel mesmo sem extensao reconhecida', () => {
    assert.equal(isPreviewable(fakeAttachment({ fileName: 'notas', mimeType: 'text/plain' })), true);
  });

  test('zip nao e previsualizavel', () => {
    assert.equal(isPreviewable(fakeAttachment({ fileName: 'projeto.zip', mimeType: 'application/zip' })), false);
  });
});

describe('decodeUtf8Prefix', () => {
  test('texto UTF-8 valido decodifica normalmente', () => {
    assert.equal(decodeUtf8Prefix(Buffer.from('café com açúcar', 'utf8')), 'café com açúcar');
  });

  test('corte no meio de um caractere multi-byte ainda decodifica (tenta cortar ate 3 bytes)', () => {
    const full = Buffer.from('café', 'utf8'); // 'é' e 2 bytes em UTF-8
    const cutMidChar = full.subarray(0, full.length - 1); // corta o 2o byte de 'é'
    assert.equal(decodeUtf8Prefix(cutMidChar), 'caf');
  });

  test('binario de verdade (nao e texto) retorna null', () => {
    const binary = Buffer.from([0xff, 0xfe, 0x00, 0x01, 0x02, 0x80, 0x81]);
    assert.equal(decodeUtf8Prefix(binary), null);
  });
});

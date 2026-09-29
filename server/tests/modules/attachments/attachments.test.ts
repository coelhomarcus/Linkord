import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { expectedChunkLength, sanitizeFileName } from '../../../src/modules/attachments/uploadSession.js';
import { contentDispositionFor, extensionOf, isPreviewable, decodeUtf8Prefix } from '../../../src/modules/attachments/attachmentServing.js';
import type { Attachment } from '../../../src/db/schema.js';

describe('expectedChunkLength', () => {
  const manifest = { totalSize: 20_000_000, chunkSize: 8_000_000, totalChunks: 3 } as Parameters<typeof expectedChunkLength>[0];

  test('every chunk before the last has exactly chunkSize', () => {
    assert.equal(expectedChunkLength(manifest, 0), 8_000_000);
    assert.equal(expectedChunkLength(manifest, 1), 8_000_000);
  });

  test('the LAST chunk is the remainder (totalSize is not always an exact multiple of chunkSize)', () => {
    assert.equal(expectedChunkLength(manifest, 2), 20_000_000 - 8_000_000 * 2); // 4_000_000
  });

  test('a file that fits in a single chunk: that one chunk is the total size', () => {
    const single = { totalSize: 500, chunkSize: 8_000_000, totalChunks: 1 } as Parameters<typeof expectedChunkLength>[0];
    assert.equal(expectedChunkLength(single, 0), 500);
  });
});

describe('contentDispositionFor', () => {
  test('a simple (ASCII-only) name is identical in both formats', () => {
    const header = contentDispositionFor('inline', 'foto.png');
    assert.equal(header, `inline; filename="foto.png"; filename*=UTF-8''foto.png`);
  });

  test('accents become _ in the ASCII fallback, but show up correctly in filename* (UTF-8)', () => {
    const header = contentDispositionFor('attachment', 'relatório.pdf');
    assert.match(header, /filename="relat_rio\.pdf"/);
    assert.match(header, /filename\*=UTF-8''relat%C3%B3rio\.pdf/);
  });

  test('double quotes in the name become single quotes in the ASCII fallback (never breaks the header)', () => {
    const header = contentDispositionFor('inline', 'nome "esquisito".txt');
    assert.match(header, /filename="nome 'esquisito'\.txt"/);
  });

  test('kind (inline/attachment) appears at the start of the header', () => {
    assert.match(contentDispositionFor('inline', 'a.png'), /^inline;/);
    assert.match(contentDispositionFor('attachment', 'a.png'), /^attachment;/);
  });
});

describe('sanitizeFileName', () => {
  test('empty/missing name falls back to "arquivo"', () => {
    assert.equal(sanitizeFileName(''), 'arquivo');
    assert.equal(sanitizeFileName(null), 'arquivo');
    assert.equal(sanitizeFileName(undefined), 'arquivo');
  });

  test('line breaks and slashes become _ (never leak into the Content-Disposition header)', () => {
    assert.equal(sanitizeFileName('nome\r\ncom\\quebras/e/barras'), 'nome__com_quebras_e_barras');
  });

  test('truncates at 200 characters', () => {
    const longName = 'a'.repeat(300);
    assert.equal(sanitizeFileName(longName).length, 200);
  });

  test('leading/trailing spaces are removed', () => {
    assert.equal(sanitizeFileName('  nome.txt  '), 'nome.txt');
  });
});

describe('extensionOf', () => {
  test('extracts the extension in lowercase', () => {
    assert.equal(extensionOf('README.MD'), 'md');
    assert.equal(extensionOf('script.py'), 'py');
  });

  test('no extension returns an empty string', () => {
    assert.equal(extensionOf('Dockerfile'), '');
  });

  test('a name with several dots uses only the last extension', () => {
    assert.equal(extensionOf('arquivo.tar.gz'), 'gz');
  });
});

describe('isPreviewable', () => {
  function fakeAttachment(overrides: Partial<Attachment> = {}): Attachment {
    return {
      id: 'a'.repeat(32), messageId: 1, uploaderId: null, fileName: 'notas.md', mimeType: 'text/markdown',
      size: 100, createdAt: new Date(), thumbId: null, isThumbnail: false, position: 0, width: null, height: null,
      ...overrides,
    };
  }

  test('an allowlisted extension is previewable even with a generic mime type', () => {
    assert.equal(isPreviewable(fakeAttachment({ fileName: 'script.py', mimeType: 'application/octet-stream' })), true);
  });

  test('mime text/* is previewable even without a recognized extension', () => {
    assert.equal(isPreviewable(fakeAttachment({ fileName: 'notas', mimeType: 'text/plain' })), true);
  });

  test('a zip is not previewable', () => {
    assert.equal(isPreviewable(fakeAttachment({ fileName: 'projeto.zip', mimeType: 'application/zip' })), false);
  });
});

describe('decodeUtf8Prefix', () => {
  test('valid UTF-8 text decodes normally', () => {
    assert.equal(decodeUtf8Prefix(Buffer.from('café com açúcar', 'utf8')), 'café com açúcar');
  });

  test('a cut in the middle of a multi-byte character still decodes (tries trimming up to 3 bytes)', () => {
    const full = Buffer.from('café', 'utf8'); // 'é' is 2 bytes in UTF-8
    const cutMidChar = full.subarray(0, full.length - 1); // cuts the 2nd byte of 'é'
    assert.equal(decodeUtf8Prefix(cutMidChar), 'caf');
  });

  test('actual binary data (not text) returns null', () => {
    const binary = Buffer.from([0xff, 0xfe, 0x00, 0x01, 0x02, 0x80, 0x81]);
    assert.equal(decodeUtf8Prefix(binary), null);
  });
});

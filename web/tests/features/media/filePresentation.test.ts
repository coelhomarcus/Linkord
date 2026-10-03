import { describe, expect, it } from 'vitest';
import { presentFile, splitFileName } from '@/features/media/filePresentation';

describe('splitFileName', () => {
  it('common name: extension is whatever comes after the last dot', () => {
    expect(splitFileName('relatorio.pdf')).toEqual({ baseName: 'relatorio', extension: 'pdf' });
  });

  it('a known compound extension (.tar.gz) stays whole, not just the last piece', () => {
    expect(splitFileName('backup.tar.gz')).toEqual({ baseName: 'backup', extension: 'tar.gz' });
  });

  it('no extension: the whole name becomes the base', () => {
    expect(splitFileName('README')).toEqual({ baseName: 'README', extension: '' });
  });

  it('a dotfile with no other dot (.env): no extension, does not "become" a nameless ".env" file', () => {
    expect(splitFileName('.env')).toEqual({ baseName: '.env', extension: '' });
  });

  it('an empty name does not break', () => {
    expect(splitFileName('')).toEqual({ baseName: '', extension: '' });
  });

  it('a unicode name preserves its characters', () => {
    expect(splitFileName('café com açúcar.docx')).toEqual({ baseName: 'café com açúcar', extension: 'docx' });
  });
});

describe('presentFile', () => {
  it('a recognized specific MIME type takes precedence over the extension', () => {
    // extension says .txt, but the MIME says PDF — MIME wins
    expect(presentFile('relatorio.txt', 'application/pdf').family).toBe('pdf');
  });

  it('a MIME with parameters (charset) is normalized before matching', () => {
    expect(presentFile('notas.md', 'text/markdown; charset=utf-8').family).toBe('text-code');
  });

  it('a generic MIME (octet-stream) falls back to the extension', () => {
    expect(presentFile('planilha.xlsx', 'application/octet-stream').family).toBe('spreadsheet');
  });

  it('an empty MIME falls back to the extension', () => {
    expect(presentFile('projeto.zip', '').family).toBe('archive');
  });

  it('an uppercase extension still classifies correctly', () => {
    expect(presentFile('CONTRATO.PDF', 'application/octet-stream').family).toBe('pdf');
  });

  it('a compound extension (.tar.gz) classifies as an archive', () => {
    expect(presentFile('dump.tar.gz', 'application/octet-stream').family).toBe('archive');
  });

  it('no extension and an unknown MIME becomes "unknown", never a technical fragment', () => {
    const p = presentFile('README', 'application/x-something-weird');
    expect(p.family).toBe('unknown');
    expect(p.typeLabel).toBe('Arquivo');
  });

  it('zero size does not affect classification', () => {
    expect(presentFile('vazio.csv', 'text/csv').family).toBe('spreadsheet');
  });

  it('image/audio/video with no applicable player keeps an identity consistent with the media', () => {
    expect(presentFile('foto.tiff', 'image/tiff').family).toBe('image');
    expect(presentFile('som.flac', 'audio/flac').family).toBe('audio');
    expect(presentFile('filme.mkv', 'video/x-matroska').family).toBe('video');
  });

  it('only PDF gets a badge — the rest are told apart by icon, not by color', () => {
    expect(presentFile('a.pdf', 'application/pdf').badge).toBe('PDF');
    expect(presentFile('a.docx', 'application/octet-stream').badge).toBeUndefined();
  });

  it('distinct families use distinct icons', () => {
    const icons = new Set([
      presentFile('a.pdf', 'application/pdf').icon,
      presentFile('a.docx', 'application/octet-stream').icon,
      presentFile('a.xlsx', 'application/octet-stream').icon,
      presentFile('a.pptx', 'application/octet-stream').icon,
      presentFile('a.zip', 'application/octet-stream').icon,
      presentFile('a.ts', 'application/octet-stream').icon,
      presentFile('a.xyz', 'application/octet-stream').icon,
    ]);
    // pdf and document share FileText on purpose (the PDF badge is what
    // tells them apart); every other family gets its own shape
    expect(icons.size).toBe(6);
  });

  it('a name diverging from the MIME does not unlock a binary preview: it only swaps the visual identity', () => {
    // a .html file served as octet-stream still just gets an identity, never special handling here
    const p = presentFile('pagina.html', 'application/octet-stream');
    expect(p.family).toBe('text-code');
    expect(p.baseName).toBe('pagina');
    expect(p.extension).toBe('html');
  });
});

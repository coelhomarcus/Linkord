import { describe, expect, it } from 'vitest';
import { presentFile, splitFileName } from '@/features/media/filePresentation';

describe('splitFileName', () => {
  it('nome comum: extensao e o que vem depois do ultimo ponto', () => {
    expect(splitFileName('relatorio.pdf')).toEqual({ baseName: 'relatorio', extension: 'pdf' });
  });

  it('extensao composta conhecida (.tar.gz) fica inteira, nao so o ultimo pedaco', () => {
    expect(splitFileName('backup.tar.gz')).toEqual({ baseName: 'backup', extension: 'tar.gz' });
  });

  it('sem extensao: o nome inteiro vira base', () => {
    expect(splitFileName('README')).toEqual({ baseName: 'README', extension: '' });
  });

  it('dotfile sem outro ponto (.env): sem extensao, nao "vira" um arquivo ".env" sem nome', () => {
    expect(splitFileName('.env')).toEqual({ baseName: '.env', extension: '' });
  });

  it('nome vazio nao quebra', () => {
    expect(splitFileName('')).toEqual({ baseName: '', extension: '' });
  });

  it('nome unicode preserva os caracteres', () => {
    expect(splitFileName('café com açúcar.docx')).toEqual({ baseName: 'café com açúcar', extension: 'docx' });
  });
});

describe('presentFile', () => {
  it('MIME especifico reconhecido tem precedencia sobre a extensao', () => {
    // extension says .txt, but the MIME says PDF — MIME wins
    expect(presentFile('relatorio.txt', 'application/pdf').family).toBe('pdf');
  });

  it('MIME com parametros (charset) e normalizado antes de reconhecer', () => {
    expect(presentFile('notas.md', 'text/markdown; charset=utf-8').family).toBe('text-code');
  });

  it('MIME generico (octet-stream) cai pra extensao', () => {
    expect(presentFile('planilha.xlsx', 'application/octet-stream').family).toBe('spreadsheet');
  });

  it('MIME vazio cai pra extensao', () => {
    expect(presentFile('projeto.zip', '').family).toBe('archive');
  });

  it('extensao em maiusculas ainda classifica certo', () => {
    expect(presentFile('CONTRATO.PDF', 'application/octet-stream').family).toBe('pdf');
  });

  it('extensao composta (.tar.gz) classifica como arquivo compactado', () => {
    expect(presentFile('dump.tar.gz', 'application/octet-stream').family).toBe('archive');
  });

  it('sem extensao e MIME desconhecido vira "unknown", nunca um fragmento tecnico', () => {
    const p = presentFile('README', 'application/x-something-weird');
    expect(p.family).toBe('unknown');
    expect(p.typeLabel).toBe('Arquivo');
  });

  it('tamanho zero nao afeta a classificacao', () => {
    expect(presentFile('vazio.csv', 'text/csv').family).toBe('spreadsheet');
  });

  it('imagem/audio/video sem player aplicavel mantem identidade coerente com a midia', () => {
    expect(presentFile('foto.tiff', 'image/tiff').family).toBe('image');
    expect(presentFile('som.flac', 'audio/flac').family).toBe('audio');
    expect(presentFile('filme.mkv', 'video/x-matroska').family).toBe('video');
  });

  it('so o PDF recebe marcador — os demais se diferenciam pelo icone, nao por cor', () => {
    expect(presentFile('a.pdf', 'application/pdf').badge).toBe('PDF');
    expect(presentFile('a.docx', 'application/octet-stream').badge).toBeUndefined();
  });

  it('familias distintas usam icones distintos', () => {
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

  it('nome divergente do MIME nao libera preview binario: so troca a identidade visual', () => {
    // a .html file served as octet-stream still just gets an identity, never special handling here
    const p = presentFile('pagina.html', 'application/octet-stream');
    expect(p.family).toBe('text-code');
    expect(p.baseName).toBe('pagina');
    expect(p.extension).toBe('html');
  });
});

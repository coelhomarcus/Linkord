import { describe, expect, it } from 'vitest';
import { formatMB, formatSizeLimit, formatFileSize } from './formatBytes';

describe('formatMB', () => {
  it('arredonda pra um numero inteiro de MB', () => {
    expect(formatMB(12 * 1024 * 1024)).toBe('12MB');
  });

  it('0 bytes vira 0MB', () => {
    expect(formatMB(0)).toBe('0MB');
  });
});

describe('formatSizeLimit', () => {
  it('abaixo de 1GB, delega pra formatMB', () => {
    expect(formatSizeLimit(500 * 1024 * 1024)).toBe('500MB');
  });

  it('exatamente 1GB ja vira GB (limite inclusivo)', () => {
    expect(formatSizeLimit(1024 * 1024 * 1024)).toBe('1GB');
  });

  it('2GB (teto de anexo real do projeto) fica legivel, nao "2048MB"', () => {
    expect(formatSizeLimit(2 * 1024 * 1024 * 1024)).toBe('2GB');
  });
});

describe('formatFileSize', () => {
  it('abaixo de 1KB, mostra em bytes inteiros', () => {
    expect(formatFileSize(500)).toBe('500 B');
  });

  it('exatamente 1024 bytes ja vira KB (limite inclusivo)', () => {
    expect(formatFileSize(1024)).toBe('1.0 KB');
  });

  it('entre KB e MB, mostra KB com 1 casa decimal', () => {
    expect(formatFileSize(1536)).toBe('1.5 KB');
  });

  it('exatamente 1MB ja vira MB', () => {
    expect(formatFileSize(1024 * 1024)).toBe('1.0 MB');
  });

  it('acima de 1MB, mostra MB com 1 casa decimal', () => {
    expect(formatFileSize(2.5 * 1024 * 1024)).toBe('2.5 MB');
  });
});

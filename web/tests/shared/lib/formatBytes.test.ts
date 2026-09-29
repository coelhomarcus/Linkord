import { describe, expect, it } from 'vitest';
import { formatMB, formatSizeLimit, formatFileSize } from '@/shared/lib/formatBytes';

describe('formatMB', () => {
  it('rounds to a whole number of MB', () => {
    expect(formatMB(12 * 1024 * 1024)).toBe('12MB');
  });

  it('0 bytes becomes 0MB', () => {
    expect(formatMB(0)).toBe('0MB');
  });
});

describe('formatSizeLimit', () => {
  it('below 1GB, delegates to formatMB', () => {
    expect(formatSizeLimit(500 * 1024 * 1024)).toBe('500MB');
  });

  it('exactly 1GB already becomes GB (inclusive threshold)', () => {
    expect(formatSizeLimit(1024 * 1024 * 1024)).toBe('1GB');
  });

  it('2GB (the project\'s real attachment ceiling) stays readable, not "2048MB"', () => {
    expect(formatSizeLimit(2 * 1024 * 1024 * 1024)).toBe('2GB');
  });
});

describe('formatFileSize — GB', () => {
  it('shows GB from 1 GiB up (2 GiB does not become "2048.0 MB")', () => {
    expect(formatFileSize(1024 ** 3)).toBe('1.0 GB');
    expect(formatFileSize(2 * 1024 ** 3)).toBe('2.0 GB');
    expect(formatFileSize(1024 ** 3 - 1)).toMatch(/MB$/);
  });
});

describe('formatFileSize', () => {
  it('below 1KB, shows whole bytes', () => {
    expect(formatFileSize(500)).toBe('500 B');
  });

  it('exactly 1024 bytes already becomes KB (inclusive threshold)', () => {
    expect(formatFileSize(1024)).toBe('1.0 KB');
  });

  it('between KB and MB, shows KB with 1 decimal place', () => {
    expect(formatFileSize(1536)).toBe('1.5 KB');
  });

  it('exactly 1MB already becomes MB', () => {
    expect(formatFileSize(1024 * 1024)).toBe('1.0 MB');
  });

  it('above 1MB, shows MB with 1 decimal place', () => {
    expect(formatFileSize(2.5 * 1024 * 1024)).toBe('2.5 MB');
  });
});

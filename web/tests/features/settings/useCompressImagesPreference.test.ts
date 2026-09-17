import { beforeEach, describe, expect, it } from 'vitest';
import { loadCompressImages, saveCompressImages } from '@/features/settings/useCompressImagesPreference';

beforeEach(() => {
  localStorage.clear();
});

describe('loadCompressImages / saveCompressImages', () => {
  it('sem nada salvo, default e true (comprimir ligado)', () => {
    expect(loadCompressImages()).toBe(true);
  });

  it('save/load faz round-trip', () => {
    saveCompressImages(false);
    expect(loadCompressImages()).toBe(false);
    saveCompressImages(true);
    expect(loadCompressImages()).toBe(true);
  });
});

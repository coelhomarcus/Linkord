import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { normalizeSearchText, useSettingsSearch } from '@/features/settings/useSettingsSearch';

function titles(results: ReturnType<typeof useSettingsSearch>['results']): string[] {
  return results.map((r) => r.entry.title);
}

describe('normalizeSearchText', () => {
  it('strips accents, ignores case, and trims edge whitespace', () => {
    expect(normalizeSearchText('  Câmera  ')).toBe('camera');
    expect(normalizeSearchText('ÁUDIO')).toBe('audio');
  });
});

describe('useSettingsSearch', () => {
  it('an empty query returns nothing (it is not a full listing)', () => {
    const { result } = renderHook(() => useSettingsSearch(false));
    expect(result.current.results).toEqual([]);
  });

  it('"camera" (no accent) finds "Câmera"', () => {
    const { result } = renderHook(() => useSettingsSearch(false));
    act(() => result.current.setQuery('camera'));
    expect(titles(result.current.results)).toContain('Câmera');
  });

  it('"foto" finds Perfil via synonym (no sectionId)', () => {
    const { result } = renderHook(() => useSettingsSearch(false));
    act(() => result.current.setQuery('foto'));
    expect(titles(result.current.results)).toContain('Perfil');
    expect(result.current.results.find((r) => r.entry.title === 'Perfil')?.entry.sectionId).toBeUndefined();
  });

  it('"som" finds Sons and/or Alto-falante', () => {
    const { result } = renderHook(() => useSettingsSearch(false));
    act(() => result.current.setQuery('som'));
    const found = titles(result.current.results);
    expect(found.some((t) => t === 'Sons' || t === 'Alto-falante')).toBe(true);
  });

  it('empty result for something that does not exist', () => {
    const { result } = renderHook(() => useSettingsSearch(false));
    act(() => result.current.setQuery('xyzxyzxyz'));
    expect(result.current.results).toEqual([]);
  });

  it('administration only appears for an admin — filtered before indexing, not just hidden in the UI', () => {
    const nonAdmin = renderHook(() => useSettingsSearch(false));
    act(() => nonAdmin.result.current.setQuery('admin'));
    expect(titles(nonAdmin.result.current.results)).not.toContain('Área administrativa');

    const admin = renderHook(() => useSettingsSearch(true));
    act(() => admin.result.current.setQuery('admin'));
    expect(titles(admin.result.current.results)).toContain('Área administrativa');
  });
});

import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { normalizeSearchText, useSettingsSearch } from '@/features/settings/useSettingsSearch';

function titles(results: ReturnType<typeof useSettingsSearch>['results']): string[] {
  return results.map((r) => r.entry.title);
}

describe('normalizeSearchText', () => {
  it('remove acentos, ignora caixa e espaços nas pontas', () => {
    expect(normalizeSearchText('  Câmera  ')).toBe('camera');
    expect(normalizeSearchText('ÁUDIO')).toBe('audio');
  });
});

describe('useSettingsSearch', () => {
  it('query vazia nao retorna nada (nao e uma listagem completa)', () => {
    const { result } = renderHook(() => useSettingsSearch(false));
    expect(result.current.results).toEqual([]);
  });

  it('"camera" (sem acento) encontra "Câmera"', () => {
    const { result } = renderHook(() => useSettingsSearch(false));
    act(() => result.current.setQuery('camera'));
    expect(titles(result.current.results)).toContain('Câmera');
  });

  it('"foto" encontra Perfil por sinonimo (sem sectionId)', () => {
    const { result } = renderHook(() => useSettingsSearch(false));
    act(() => result.current.setQuery('foto'));
    expect(titles(result.current.results)).toContain('Perfil');
    expect(result.current.results.find((r) => r.entry.title === 'Perfil')?.entry.sectionId).toBeUndefined();
  });

  it('"som" encontra Sons e/ou Alto-falante', () => {
    const { result } = renderHook(() => useSettingsSearch(false));
    act(() => result.current.setQuery('som'));
    const found = titles(result.current.results);
    expect(found.some((t) => t === 'Sons' || t === 'Alto-falante')).toBe(true);
  });

  it('resultado vazio para algo que nao existe', () => {
    const { result } = renderHook(() => useSettingsSearch(false));
    act(() => result.current.setQuery('xyzxyzxyz'));
    expect(result.current.results).toEqual([]);
  });

  it('administracao so aparece pra admin — filtrado antes de indexar, nao so escondido na UI', () => {
    const nonAdmin = renderHook(() => useSettingsSearch(false));
    act(() => nonAdmin.result.current.setQuery('admin'));
    expect(titles(nonAdmin.result.current.results)).not.toContain('Área administrativa');

    const admin = renderHook(() => useSettingsSearch(true));
    act(() => admin.result.current.setQuery('admin'));
    expect(titles(admin.result.current.results)).toContain('Área administrativa');
  });
});

import { describe, expect, it } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useCursorList } from '@/features/friends/useCursorList';

type Row = { id: string };
const rows = (...ids: string[]): Row[] => ids.map((id) => ({ id }));
const key = (row: Row) => row.id;

/** A fetcher whose responses are settled by hand, in any order. */
function controlled() {
  const calls: { cursor: string | null; resolve: (page: { items: Row[]; nextCursor: string | null }) => void; reject: (err: Error) => void }[] = [];
  const fetchPage = (cursor: string | null) => new Promise<{ items: Row[]; nextCursor: string | null }>((resolve, reject) => { calls.push({ cursor, resolve, reject }); });
  return { calls, fetchPage };
}

describe('useCursorList', () => {
  it('carrega a primeira pagina e pagina por cursor', async () => {
    const { calls, fetchPage } = controlled();
    const { result } = renderHook(() => useCursorList(fetchPage, 'q', { getKey: key }));
    expect(result.current.status).toBe('loading');
    await act(async () => calls[0]!.resolve({ items: rows('a', 'b'), nextCursor: 'c1' }));
    expect(result.current.items).toEqual(rows('a', 'b'));
    expect(result.current.hasMore).toBe(true);
    act(() => result.current.loadMore());
    expect(calls[1]!.cursor).toBe('c1');
    await act(async () => calls[1]!.resolve({ items: rows('c'), nextCursor: null }));
    expect(result.current.items).toEqual(rows('a', 'b', 'c'));
    expect(result.current.hasMore).toBe(false);
  });

  it('mudar a identidade limpa as linhas antigas na hora (nada do contexto anterior sob o novo)', async () => {
    const { calls, fetchPage } = controlled();
    const { result, rerender } = renderHook(({ q }) => useCursorList(fetchPage, q, { getKey: key }), { initialProps: { q: 'ana' } });
    await act(async () => calls[0]!.resolve({ items: rows('a'), nextCursor: null }));
    expect(result.current.items).toHaveLength(1);
    rerender({ q: 'bea' });
    await waitFor(() => expect(result.current.status).toBe('loading'));
    expect(result.current.items).toEqual([]);
  });

  it('resposta de uma consulta substituida nao sobrescreve a nova (fora de ordem)', async () => {
    const { calls, fetchPage } = controlled();
    const { result, rerender } = renderHook(({ q }) => useCursorList(fetchPage, q, { getKey: key }), { initialProps: { q: 'ana' } });
    rerender({ q: 'bea' });
    await waitFor(() => expect(calls.length).toBe(2));
    await act(async () => calls[1]!.resolve({ items: rows('bea'), nextCursor: null })); // the NEW one lands first
    await act(async () => calls[0]!.resolve({ items: rows('ana'), nextCursor: null })); // the old one, late
    expect(result.current.items).toEqual(rows('bea'));
  });

  it('a revisao refaz TODAS as paginas ja carregadas, mantendo as linhas enquanto le', async () => {
    const { calls, fetchPage } = controlled();
    const { result, rerender } = renderHook(({ rev }) => useCursorList(fetchPage, 'q', { revision: rev, getKey: key }), { initialProps: { rev: 0 } });
    await act(async () => calls[0]!.resolve({ items: rows('a', 'b'), nextCursor: 'c1' }));
    act(() => result.current.loadMore());
    await act(async () => calls[1]!.resolve({ items: rows('c', 'd'), nextCursor: 'c2' }));
    expect(result.current.items).toHaveLength(4);

    rerender({ rev: 1 });
    await waitFor(() => expect(calls.length).toBe(3));
    expect(result.current.items).toHaveLength(4); // still on screen
    expect(result.current.refreshing).toBe(true);
    await act(async () => calls[2]!.resolve({ items: rows('a', 'x'), nextCursor: 'c1b' }));
    await waitFor(() => expect(calls.length).toBe(4));
    expect(calls[3]!.cursor).toBe('c1b'); // it walked the chain again up to the same depth
    await act(async () => calls[3]!.resolve({ items: rows('y'), nextCursor: null }));
    expect(result.current.items).toEqual(rows('a', 'x', 'y'));
    expect(result.current.refreshing).toBe(false);
    expect(result.current.stale).toBe(false);
  });

  it('falha no refresh mantem a janela anterior, marcada como desatualizada, e da para tentar de novo', async () => {
    const { calls, fetchPage } = controlled();
    const { result, rerender } = renderHook(({ rev }) => useCursorList(fetchPage, 'q', { revision: rev, getKey: key }), { initialProps: { rev: 0 } });
    await act(async () => calls[0]!.resolve({ items: rows('a'), nextCursor: null }));
    rerender({ rev: 1 });
    await waitFor(() => expect(calls.length).toBe(2));
    await act(async () => calls[1]!.reject(new Error('rede')));
    expect(result.current.items).toEqual(rows('a'));
    expect(result.current.status).toBe('ready');
    expect(result.current.stale).toBe(true);
    act(() => result.current.retry());
    await waitFor(() => expect(calls.length).toBe(3));
    await act(async () => calls[2]!.resolve({ items: rows('a', 'z'), nextCursor: null }));
    expect(result.current.stale).toBe(false);
    expect(result.current.items).toEqual(rows('a', 'z'));
  });

  it('erro em "carregar mais" nao apaga a lista: fica separado e da para repetir', async () => {
    const { calls, fetchPage } = controlled();
    const { result } = renderHook(() => useCursorList(fetchPage, 'q', { getKey: key }));
    await act(async () => calls[0]!.resolve({ items: rows('a'), nextCursor: 'c1' }));
    act(() => result.current.loadMore());
    await act(async () => calls[1]!.reject(new Error('rede')));
    expect(result.current.status).toBe('ready');
    expect(result.current.items).toEqual(rows('a'));
    expect(result.current.loadMoreError).toBe(true);
    act(() => result.current.loadMore());
    await act(async () => calls[2]!.resolve({ items: rows('b'), nextCursor: null }));
    expect(result.current.loadMoreError).toBe(false);
    expect(result.current.items).toEqual(rows('a', 'b'));
  });

  it('falha na PRIMEIRA carga vira erro e o retry recarrega', async () => {
    const { calls, fetchPage } = controlled();
    const { result } = renderHook(() => useCursorList(fetchPage, 'q'));
    await act(async () => calls[0]!.reject(new Error('rede')));
    expect(result.current.status).toBe('error');
    act(() => result.current.retry());
    await act(async () => calls[1]!.resolve({ items: rows('a'), nextCursor: null }));
    expect(result.current.status).toBe('ready');
  });

  it('deduplica por id (uma linha que aparece em duas paginas)', async () => {
    const { calls, fetchPage } = controlled();
    const { result } = renderHook(() => useCursorList(fetchPage, 'q', { getKey: key }));
    await act(async () => calls[0]!.resolve({ items: rows('a', 'b'), nextCursor: 'c1' }));
    act(() => result.current.loadMore());
    await act(async () => calls[1]!.resolve({ items: rows('b', 'c'), nextCursor: null }));
    expect(result.current.items).toEqual(rows('a', 'b', 'c'));
  });

  it('removeItem tira a linha e descarta uma leitura anterior que a traria de volta', async () => {
    const { calls, fetchPage } = controlled();
    const { result, rerender } = renderHook(({ rev }) => useCursorList(fetchPage, 'q', { revision: rev, getKey: key }), { initialProps: { rev: 0 } });
    await act(async () => calls[0]!.resolve({ items: rows('a', 'b'), nextCursor: null }));
    rerender({ rev: 1 }); // a refresh starts...
    await waitFor(() => expect(calls.length).toBe(2));
    act(() => result.current.removeItem('a')); // ...an action confirms 'a' is gone
    await act(async () => calls[1]!.resolve({ items: rows('a', 'b'), nextCursor: null })); // the old read still lists it
    expect(result.current.items).toEqual(rows('b'));
  });

  it('resposta que chega depois de desmontar e ignorada', async () => {
    const { calls, fetchPage } = controlled();
    const { unmount } = renderHook(() => useCursorList(fetchPage, 'q'));
    unmount();
    await act(async () => calls[0]!.resolve({ items: rows('a'), nextCursor: null }));
    // nothing to assert beyond "no state update on an unmounted hook, no throw"
    expect(calls).toHaveLength(1);
  });
});

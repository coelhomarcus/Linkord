import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { useAdminQuery } from '@/features/admin/useAdminQuery';
import type { QuerySchema } from '@/features/admin/useAdminQuery';

const SCHEMA: QuerySchema<'q' | 'status'> = {
  q: { default: '' },
  status: { default: 'all', allowed: ['all', 'active', 'suspended'] },
};

function setup(initial: string) {
  const wrapper = ({ children }: { children: ReactNode }) => <MemoryRouter initialEntries={[initial]}>{children}</MemoryRouter>;
  return renderHook(() => ({ query: useAdminQuery(SCHEMA), location: useLocation() }), { wrapper });
}

describe('useAdminQuery', () => {
  it('reads known filters from the URL and falls back to defaults', () => {
    const { result } = setup('/admin/users?q=ana&status=suspended');
    expect(result.current.query.filters).toEqual({ q: 'ana', status: 'suspended' });
    expect(result.current.query.active).toBe(true);
  });

  it('a value outside the allowed set reads as the default (a hand-edited link cannot break the list)', () => {
    const { result } = setup('/admin/users?status=banana');
    expect(result.current.query.filters.status).toBe('all');
    expect(result.current.query.active).toBe(false);
  });

  it('writes only non-default known keys, drops unknown ones, and replaces the history entry', () => {
    const { result } = setup('/admin/users?utm=x&q=ana');
    act(() => result.current.query.update({ status: 'active' }));
    expect(result.current.location.search).toBe('?q=ana&status=active');
    act(() => result.current.query.update({ status: 'all' }));
    expect(result.current.location.search).toBe('?q=ana');
  });

  it('two fields settling in the same tick do not overwrite each other', () => {
    const { result } = setup('/admin/users');
    act(() => {
      result.current.query.update({ q: 'ana' });
      result.current.query.update({ status: 'active' });
    });
    expect(result.current.location.search).toBe('?q=ana&status=active');
  });

  it('clear goes back to the bare URL', () => {
    const { result } = setup('/admin/users?q=ana&status=active');
    act(() => result.current.query.clear());
    expect(result.current.location.search).toBe('');
    expect(result.current.query.active).toBe(false);
  });

  it('the identity is structured: a search text with any separator cannot collide with another query', () => {
    const a = setup('/admin/users?q=' + encodeURIComponent('a|all')).result.current.query.identity;
    const b = setup('/admin/users?q=a').result.current.query.identity;
    expect(a).not.toBe(b);
  });
});

import { describe, expect, it } from 'vitest';
import { ADMIN_WIDE_MIN, adminModeForWidth } from '@/features/admin/useAdminLayout';
import { sectionForPath } from '@/features/admin/adminCatalog';

describe('adminModeForWidth', () => {
  it('the section sidebar only stays when the admin area fits both columns', () => {
    expect(adminModeForWidth(ADMIN_WIDE_MIN - 1)).toBe('compact');
    expect(adminModeForWidth(ADMIN_WIDE_MIN)).toBe('wide');
    expect(adminModeForWidth(2560)).toBe('wide');
  });

  it('a zero width (not yet measured) never starts compact', () => {
    expect(adminModeForWidth(0)).toBe('wide');
  });
});

describe('sectionForPath', () => {
  it('a detail page belongs to its list section', () => {
    expect(sectionForPath('/admin/users')?.id).toBe('users');
    expect(sectionForPath('/admin/reports/r1')?.id).toBe('reports');
  });

  it('the bare entry and unknown paths belong to no section', () => {
    expect(sectionForPath('/admin')).toBeNull();
    expect(sectionForPath('/admin/nada')).toBeNull();
  });
});

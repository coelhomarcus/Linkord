import { describe, expect, it } from 'vitest';
import { SETTINGS_WIDE_MIN, modeForWidth } from '@/features/settings/useSettingsLayout';

describe('modeForWidth', () => {
  it('the category sidebar only stays when the settings area fits both columns', () => {
    expect(modeForWidth(SETTINGS_WIDE_MIN - 1)).toBe('compact');
    expect(modeForWidth(SETTINGS_WIDE_MIN)).toBe('wide');
    expect(modeForWidth(SETTINGS_WIDE_MIN + 1)).toBe('wide');
    expect(modeForWidth(519)).toBe('compact');
    expect(modeForWidth(2560)).toBe('wide');
  });

  it('a zero width (not yet measured) never starts compact', () => {
    expect(modeForWidth(0)).toBe('wide');
  });
});

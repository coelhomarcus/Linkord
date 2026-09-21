import { describe, expect, it } from 'vitest';
import { SETTINGS_WIDE_MIN, modeForWidth } from '@/features/settings/useSettingsLayout';

describe('modeForWidth', () => {
  it('a sidebar de categorias so fica quando a area de ajustes comporta as duas colunas', () => {
    expect(modeForWidth(SETTINGS_WIDE_MIN - 1)).toBe('compact');
    expect(modeForWidth(SETTINGS_WIDE_MIN)).toBe('wide');
    expect(modeForWidth(SETTINGS_WIDE_MIN + 1)).toBe('wide');
    expect(modeForWidth(519)).toBe('compact');
    expect(modeForWidth(2560)).toBe('wide');
  });

  it('largura zero (ainda nao medida) nunca comeca compacta', () => {
    expect(modeForWidth(0)).toBe('wide');
  });
});

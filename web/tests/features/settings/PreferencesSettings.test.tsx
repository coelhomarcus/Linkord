import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RoomContext } from '@/state/RoomContext';
import { createFakeRoomContextValue } from '@tests/fixtures/roomContextFixture';
import { PreferencesSettings } from '@/features/settings/PreferencesSettings';

function renderPreferences(overrides: Parameters<typeof createFakeRoomContextValue>[0] = {}) {
  return render(
    <RoomContext.Provider value={createFakeRoomContextValue(overrides)}>
      <PreferencesSettings />
    </RoomContext.Provider>,
  );
}

describe('PreferencesSettings', () => {
  it('mostra os 4 controles da tabela do plano, com o estado real de cada um', () => {
    renderPreferences({ showTileBanners: true, hideAudioOnlyTiles: true, showStats: false, compressImagesDefault: false });

    expect(screen.getByRole('switch', { name: 'Mostrar banners nos tiles' })).toBeChecked();
    expect(screen.getByRole('switch', { name: 'Ocultar participantes sem vídeo' })).toBeChecked();
    expect(screen.getByRole('switch', { name: 'Mostrar estatísticas' })).not.toBeChecked();
    expect(screen.getByRole('switch', { name: 'Compactar imagens por padrão' })).not.toBeChecked();
  });

  it('ocultar participantes sem video usa a mesma fonte de estado do atalho de contexto', async () => {
    const setHideAudioOnlyTiles = vi.fn();
    const user = userEvent.setup();
    renderPreferences({ hideAudioOnlyTiles: false, setHideAudioOnlyTiles });

    await user.click(screen.getByRole('switch', { name: 'Ocultar participantes sem vídeo' }));
    // the Switch primitive itself calls onCheckedChange with (checked, eventDetails)
    expect(setHideAudioOnlyTiles.mock.calls[0]?.[0]).toBe(true);
  });

  it('compactar imagens por padrao chama o setter compartilhado com o compositor', async () => {
    const setCompressImagesDefault = vi.fn();
    const user = userEvent.setup();
    renderPreferences({ compressImagesDefault: true, setCompressImagesDefault });

    await user.click(screen.getByRole('switch', { name: 'Compactar imagens por padrão' }));
    expect(setCompressImagesDefault.mock.calls[0]?.[0]).toBe(false);
  });
});

import { useCallback, useEffect, useState } from 'react';
import { loadShowStats, saveShowStats, loadNotifyVolume, saveNotifyVolume } from './useSettingsPreference';
import { loadHideAudioOnlyTiles, saveHideAudioOnlyTiles } from './useStageViewPreference';
import { loadShowTileBanners, saveShowTileBanners } from './useTileBannerPreference';
import { loadCompressImages, saveCompressImages } from './useCompressImagesPreference';
import { loadNoiseSuppression, saveNoiseSuppression } from './useNoiseSuppressionPreference';
import { setVolume } from '@/shared/sounds';
import { setNotificationsModuleEnabled, loadNotificationsEnabled, saveNotificationsEnabled } from '@/shared/notifications';

/** The 7 user-facing toggles/sliders under Ajustes — each backed by its own
 * `features/settings/useXPreference.ts` localStorage pair, wired up here
 * into React state with a setter that persists on change. `notifyVolume`
 * and `notificationsEnabled` also keep the `shared/sounds`/`shared/notifications`
 * module-level singletons in sync, since those modules can't read React
 * state themselves. `applyNoiseSuppression` comes from `useMicrophone` —
 * flipping the toggle has to reach the actual LiveKit audio track, not just
 * persist a preference. */
export function useRoomSettings(applyNoiseSuppression: (enabled: boolean) => Promise<void>) {
  const [showStats, setShowStatsState] = useState(loadShowStats);
  const setShowStats = useCallback((value: boolean) => {
    setShowStatsState(value);
    saveShowStats(value);
  }, []);

  const [notifyVolume, setNotifyVolumeState] = useState(loadNotifyVolume);
  const setNotifyVolume = useCallback((value: number) => {
    setNotifyVolumeState(value);
    saveNotifyVolume(value);
    setVolume(value);
  }, []);

  const [notificationsEnabled, setNotificationsEnabledState] = useState(loadNotificationsEnabled);
  const setNotificationsEnabled = useCallback((value: boolean) => {
    setNotificationsEnabledState(value);
    saveNotificationsEnabled(value);
    setNotificationsModuleEnabled(value);
  }, []);

  const [hideAudioOnlyTiles, setHideAudioOnlyTilesState] = useState(loadHideAudioOnlyTiles);
  const setHideAudioOnlyTiles = useCallback((value: boolean) => {
    setHideAudioOnlyTilesState(value);
    saveHideAudioOnlyTiles(value);
  }, []);

  const [showTileBanners, setShowTileBannersState] = useState(loadShowTileBanners);
  const setShowTileBanners = useCallback((value: boolean) => {
    setShowTileBannersState(value);
    saveShowTileBanners(value);
  }, []);

  const [compressImagesDefault, setCompressImagesDefaultState] = useState(loadCompressImages);
  const setCompressImagesDefault = useCallback((value: boolean) => {
    setCompressImagesDefaultState(value);
    saveCompressImages(value);
  }, []);

  const [noiseSuppressionEnabled, setNoiseSuppressionEnabledState] = useState(loadNoiseSuppression);
  const setNoiseSuppressionEnabled = useCallback((value: boolean) => {
    setNoiseSuppressionEnabledState(value);
    saveNoiseSuppression(value);
    applyNoiseSuppression(value);
  }, [applyNoiseSuppression]);

  useEffect(() => {
    setVolume(notifyVolume);
  }, [notifyVolume]);

  useEffect(() => {
    setNotificationsModuleEnabled(notificationsEnabled);
  }, [notificationsEnabled]);

  return {
    showStats, setShowStats,
    notifyVolume, setNotifyVolume,
    notificationsEnabled, setNotificationsEnabled,
    hideAudioOnlyTiles, setHideAudioOnlyTiles,
    showTileBanners, setShowTileBanners,
    compressImagesDefault, setCompressImagesDefault,
    noiseSuppressionEnabled, setNoiseSuppressionEnabled,
  };
}

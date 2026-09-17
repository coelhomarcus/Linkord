import { useCallback } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { uploadWithProgress } from '@/shared/lib/uploadWithProgress';
import { DEFAULT_AVATAR_COLOR, normalizeAvatarColor } from '@/shared/Avatar';
import { sanitizeDisplayName } from '@/shared/lib/displayName';
import type { ClientMessage, PublicUser } from '@/shared/types/protocol';
import { MAX_BANNER_LEN, MAX_PROFILE_BIO_LEN, MAX_PROFILE_LINK_LEN, MAX_PROFILE_LINKS } from '@/shared/types/protocol';
import type { RoomAction } from '@/state/roomReducer';
import type { CropRect } from '@/state/RoomContext';

function sanitizeImageUrl(value: unknown): string {
  const url = String(value == null ? '' : value).trim().slice(0, MAX_BANNER_LEN);
  return /^https?:\/\/\S+$/i.test(url) || /^\/uploads\/[0-9a-f]{32}$/.test(url) ? url : '';
}

function sanitizeBio(value: unknown): string {
  return String(value == null ? '' : value).replace(/\r\n?/g, '\n').trim().slice(0, MAX_PROFILE_BIO_LEN);
}

function sanitizeProfileLinks(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const links: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const url = String(item == null ? '' : item).trim().slice(0, MAX_PROFILE_LINK_LEN);
    if (!/^https?:\/\/\S+$/i.test(url)) continue;
    const key = url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    links.push(url);
    if (links.length >= MAX_PROFILE_LINKS) break;
  }
  return links;
}

interface ProfileUpdateDeps {
  dispatch: Dispatch<RoomAction>;
  sendWs: (msg: ClientMessage) => void;
  myUserIdRef: MutableRefObject<string | null>;
  setAllUsers: Dispatch<SetStateAction<Map<string, PublicUser>>>;
  name: string;
  avatar: string;
  avatarPoster: string;
  avatarColor: string;
  banner: string;
  bannerPoster: string;
  bio: string;
  displayName: string;
  profileLinks: string[];
}

/** Everything about changing the local account's profile: the account-edit
 * form path (`updateProfile`/`updateAvatar`) and the avatar/banner upload
 * path (`uploadProfileImage`), which both funnel through the same
 * `updateProfile` so the optimistic local update (reducer + `allUsers`
 * entry) and the server round-trip (`sendWs({t:'profile',...})`) only
 * happen in one place. Takes individual `state.me` fields (not the whole
 * `me` object) so each callback's identity only changes when a field it
 * actually reads changes — matches the granularity the original inline
 * `useCallback` deps had (e.g. `updateProfile` never depended on
 * `cameraOn`/`sharing`, which change far more often). */
export function useProfileUpdate(deps: ProfileUpdateDeps) {
  const {
    dispatch, sendWs, myUserIdRef, setAllUsers,
    name, avatar, avatarPoster, avatarColor, banner, bannerPoster, bio, displayName, profileLinks,
  } = deps;

  const updateProfile = useCallback((profile: { avatar: string; avatarPoster: string; avatarColor: string; displayName: string; banner: string; bannerPoster: string; bio: string; profileLinks: string[] }) => {
    const finalAvatar = profile.avatar.trim().slice(0, 500);
    const finalAvatarPoster = sanitizeImageUrl(profile.avatarPoster);
    const finalAvatarColor = normalizeAvatarColor(profile.avatarColor) || DEFAULT_AVATAR_COLOR;
    const finalDisplayName = sanitizeDisplayName(profile.displayName) || name;
    const finalBanner = sanitizeImageUrl(profile.banner);
    const finalBannerPoster = sanitizeImageUrl(profile.bannerPoster);
    const finalBio = sanitizeBio(profile.bio);
    const finalProfileLinks = sanitizeProfileLinks(profile.profileLinks);
    dispatch({
      type: 'SET_LOCAL_PROFILE',
      avatar: finalAvatar,
      avatarPoster: finalAvatarPoster,
      avatarColor: finalAvatarColor,
      displayName: finalDisplayName,
      banner: finalBanner,
      bannerPoster: finalBannerPoster,
      bio: finalBio,
      profileLinks: finalProfileLinks,
    });
    setAllUsers((prev) => {
      const userId = myUserIdRef.current;
      if (!userId) return prev;
      const existing = prev.get(userId);
      if (!existing || (
        existing.avatar === finalAvatar && existing.avatarColor === finalAvatarColor && existing.displayName === finalDisplayName
        && existing.banner === finalBanner && existing.bio === finalBio
        && JSON.stringify(existing.profileLinks) === JSON.stringify(finalProfileLinks)
      )) return prev;
      const next = new Map(prev);
      next.set(userId, {
        ...existing,
        avatar: finalAvatar,
        avatarColor: finalAvatarColor,
        displayName: finalDisplayName,
        banner: finalBanner,
        bio: finalBio,
        profileLinks: finalProfileLinks,
      });
      return next;
    });
    sendWs({
      t: 'profile',
      avatar: finalAvatar,
      avatarPoster: finalAvatarPoster,
      avatarColor: finalAvatarColor,
      displayName: finalDisplayName,
      banner: finalBanner,
      bannerPoster: finalBannerPoster,
      bio: finalBio,
      profileLinks: finalProfileLinks,
    });
  }, [dispatch, sendWs, name, setAllUsers, myUserIdRef]);

  const updateAvatar = useCallback((newAvatar: string) => {
    updateProfile({
      avatar: newAvatar,
      avatarPoster: '', // a poster only exists for an animated avatar generated by our own upload pipeline — never known here
      avatarColor,
      displayName,
      banner,
      bannerPoster,
      bio,
      profileLinks,
    });
  }, [avatarColor, banner, bannerPoster, bio, displayName, profileLinks, updateProfile]);

  const uploadProfileImageBody = useCallback(async (
    field: 'avatar' | 'banner',
    body: Blob,
    headers: Record<string, string>,
    crop: CropRect,
    onProgress?: (fraction: number) => void,
    profile?: { avatarColor?: string; displayName?: string; avatar?: string; banner?: string; bio?: string; profileLinks?: string[] }
  ) => {
    const res = await uploadWithProgress<{ avatar: string; avatarPoster?: string }>({
      url: `/api/avatar?crop=${encodeURIComponent(JSON.stringify(crop))}`,
      file: body,
      headers,
      onProgress,
    });
    const url = res.avatar;
    const posterUrl = res.avatarPoster ?? '';
    updateProfile({
      avatar: field === 'avatar' ? url : (profile?.avatar ?? avatar),
      avatarPoster: field === 'avatar' ? posterUrl : avatarPoster,
      avatarColor: profile?.avatarColor ?? avatarColor,
      displayName: profile?.displayName ?? displayName,
      banner: field === 'banner' ? url : (profile?.banner ?? banner),
      bannerPoster: field === 'banner' ? posterUrl : bannerPoster,
      bio: profile?.bio ?? bio,
      profileLinks: profile?.profileLinks ?? profileLinks,
    });
    return url;
  }, [avatar, avatarPoster, avatarColor, banner, bannerPoster, bio, displayName, profileLinks, updateProfile]);

  const uploadProfileImage = useCallback((
    field: 'avatar' | 'banner',
    file: Blob,
    crop: CropRect,
    onProgress?: (fraction: number) => void,
    profile?: { avatarColor?: string; displayName?: string; avatar?: string; banner?: string; bio?: string; profileLinks?: string[] }
  ) => uploadProfileImageBody(field, file, { 'Content-Type': file.type || 'application/octet-stream' }, crop, onProgress, profile),
  [uploadProfileImageBody]);

  return { updateProfile, updateAvatar, uploadProfileImage };
}

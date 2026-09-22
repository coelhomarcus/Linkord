import { useCallback, useEffect, useRef } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { uploadWithProgress } from '@/shared/lib/uploadWithProgress';
import { DEFAULT_AVATAR_COLOR, normalizeAvatarColor } from '@/shared/Avatar';
import { sanitizeDisplayName } from '@/shared/lib/displayName';
import type { ClientMessage, ProfilePatch, PublicUser, ServerMessage } from '@/shared/types/protocol';
import { MAX_BANNER_LEN, MAX_PROFILE_BIO_LEN, MAX_PROFILE_LINK_LEN, MAX_PROFILE_LINKS } from '@/shared/types/protocol';
import type { RoomAction } from '@/state/roomReducer';
import type { CropRect } from '@/state/RoomContext';

const PROFILE_SAVE_TIMEOUT_MS = 15_000;

/** A `profile` patch that never got a confirmed answer — the connection
 * dropped mid-request, the server never dispatched it, or is offline right
 * now. Distinct from a `code`d refusal (`ProfileSaveRefused` below): the
 * account might still be saved, might not; the caller can't tell which. */
export class ProfileSaveTimeout extends Error {
  constructor() { super('O perfil não foi confirmado a tempo. Verifique sua conexão e tente de novo.'); }
}

/** The server explicitly refused the patch (see participants.ts#handleProfile). */
export class ProfileSaveRefused extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}

/** Never queued at all — no live connection to send it over. Distinguished
 * from a timeout so the UI can say "sem conexão" instead of "não respondeu",
 * and so it fails at once instead of only after the timeout. */
export class ProfileSaveOffline extends Error {
  constructor() { super('Sem conexão com o servidor. Tente de novo em instantes.'); }
}

/** Turns a rejection of `updateProfile`/`uploadProfileImage`/`removeProfileImage`
 * into UI text. `fallback` covers a plain Error a caller wants worded for its
 * own context (e.g. "Falha ao enviar a foto." instead of the generic one). */
export function describeProfileSaveError(err: unknown, fallback = 'Não foi possível salvar o perfil. Tente de novo.'): string {
  if (err instanceof ProfileSaveOffline || err instanceof ProfileSaveTimeout) return err.message;
  if (err instanceof ProfileSaveRefused) return err.message || fallback;
  return fallback;
}

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

type ProfileResultOk = Extract<ServerMessage, { t: 'profile-result'; ok: true }>;
type PendingEntry = { resolve: (value: ProfileResultOk) => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> };

interface ProfileUpdateDeps {
  dispatch: Dispatch<RoomAction>;
  sendWs: (msg: ClientMessage) => void;
  isConnected: () => boolean;
  myUserIdRef: MutableRefObject<string | null>;
  setAllUsers: Dispatch<SetStateAction<Map<string, PublicUser>>>;
  name: string;
}

/** Everything about changing the local account's profile, built around ONE
 * confirmed round trip (`profile` → `profile-result`, correlated by
 * `requestId`): the form-save path (`updateProfile`, the full sanitized
 * draft) and the avatar/banner path (`uploadProfileImage`, which sends
 * ONLY the image fields — never the rest of whatever is currently typed in
 * the form, so an upload can't publish an unrelated unsaved edit). Local
 * state (the reducer + the `allUsers` entry) only updates once the server
 * confirms — never from the request itself, and never from
 * `participant-updated`, which fires for this same change too but carries
 * no correlation to know whether it was ours or another session's. */
export function useProfileUpdate(deps: ProfileUpdateDeps) {
  const { dispatch, sendWs, isConnected, myUserIdRef, setAllUsers, name } = deps;
  const pendingRef = useRef(new Map<string, PendingEntry>());

  // in-flight requests can never resolve after the hook (and the socket
  // connection with it) is gone — reject them instead of leaking timers
  useEffect(() => () => {
    for (const [, entry] of pendingRef.current) {
      clearTimeout(entry.timer);
      entry.reject(new ProfileSaveTimeout());
    }
    pendingRef.current.clear();
  }, []);

  const applyConfirmed = useCallback((profile: ProfilePatch) => {
    dispatch({
      type: 'SET_LOCAL_PROFILE',
      avatar: profile.avatar ?? '', avatarPoster: profile.avatarPoster ?? '', avatarColor: profile.avatarColor ?? DEFAULT_AVATAR_COLOR,
      displayName: profile.displayName ?? name, banner: profile.banner ?? '', bannerPoster: profile.bannerPoster ?? '',
      bio: profile.bio ?? '', profileLinks: profile.profileLinks ?? [],
    });
    setAllUsers((prev) => {
      const userId = myUserIdRef.current;
      if (!userId) return prev;
      const existing = prev.get(userId);
      if (!existing) return prev;
      const next = new Map(prev);
      next.set(userId, {
        ...existing,
        avatar: profile.avatar ?? existing.avatar, avatarColor: profile.avatarColor ?? existing.avatarColor,
        displayName: profile.displayName ?? existing.displayName, banner: profile.banner ?? existing.banner,
        bio: profile.bio ?? existing.bio, profileLinks: profile.profileLinks ?? existing.profileLinks,
      });
      return next;
    });
  }, [dispatch, setAllUsers, myUserIdRef, name]);

  /** Wired into RoomProvider's own message switch (case 'profile-result'). */
  const handleProfileResult = useCallback((m: Extract<ServerMessage, { t: 'profile-result' }>) => {
    const entry = pendingRef.current.get(m.requestId);
    if (!entry) return; // answers a request from a previous session, or already timed out
    pendingRef.current.delete(m.requestId);
    clearTimeout(entry.timer);
    if (!m.ok) { entry.reject(new ProfileSaveRefused(m.code, m.message)); return; }
    applyConfirmed(m);
    entry.resolve(m);
  }, [applyConfirmed]);

  const sendPatch = useCallback((patch: ProfilePatch): Promise<ProfileResultOk> => {
    if (!isConnected()) return Promise.reject(new ProfileSaveOffline());
    const requestId = crypto.randomUUID();
    return new Promise<ProfileResultOk>((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingRef.current.delete(requestId);
        reject(new ProfileSaveTimeout());
      }, PROFILE_SAVE_TIMEOUT_MS);
      pendingRef.current.set(requestId, { resolve, reject, timer });
      sendWs({ t: 'profile', requestId, ...patch });
    });
  }, [isConnected, sendWs]);

  /** The "Salvar perfil" path: the whole sanitized draft, all 8 fields. */
  const updateProfile = useCallback((profile: { avatar: string; avatarPoster: string; avatarColor: string; displayName: string; banner: string; bannerPoster: string; bio: string; profileLinks: string[] }) => sendPatch({
    avatar: profile.avatar.trim().slice(0, 500),
    avatarPoster: sanitizeImageUrl(profile.avatarPoster),
    avatarColor: normalizeAvatarColor(profile.avatarColor) || DEFAULT_AVATAR_COLOR,
    displayName: sanitizeDisplayName(profile.displayName) || name,
    banner: sanitizeImageUrl(profile.banner),
    bannerPoster: sanitizeImageUrl(profile.bannerPoster),
    bio: sanitizeBio(profile.bio),
    profileLinks: sanitizeProfileLinks(profile.profileLinks),
  }), [sendPatch, name]);

  /** Persists just the image field(s) — no other key is ever present in this
   * patch, so the server (which only changes what a patch actually names)
   * can't touch displayName/bio/color/links no matter what the form
   * currently has typed into it. */
  const applyImagePatch = useCallback((field: 'avatar' | 'banner', url: string, posterUrl: string) => (
    sendPatch(field === 'avatar' ? { avatar: url, avatarPoster: posterUrl } : { banner: url, bannerPoster: posterUrl })
  ), [sendPatch]);

  const uploadProfileImage = useCallback(async (
    field: 'avatar' | 'banner',
    body: Blob,
    crop: CropRect,
    onProgress?: (fraction: number) => void,
  ): Promise<string> => {
    const res = await uploadWithProgress<{ avatar: string; avatarPoster?: string }>({
      url: `/api/avatar?crop=${encodeURIComponent(JSON.stringify(crop))}`,
      file: body,
      headers: { 'Content-Type': body.type || 'application/octet-stream' },
      onProgress,
    });
    await applyImagePatch(field, res.avatar, res.avatarPoster ?? '');
    return res.avatar;
  }, [applyImagePatch]);

  const removeProfileImage = useCallback((field: 'avatar' | 'banner') => applyImagePatch(field, '', ''), [applyImagePatch]);

  return { updateProfile, uploadProfileImage, removeProfileImage, handleProfileResult };
}

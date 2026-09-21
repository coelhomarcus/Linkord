import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import type { Area } from 'react-easy-crop';
import { Check } from 'lucide-react';
import { ImageCropDialog } from './ImageCropDialog';
import { ImageUrlDialog } from '@/shared/ImageUrlDialog';
import { ProfileCard } from '@/features/profile/ProfileCard';
import { useRoom } from '@/state/RoomContext';
import { DEFAULT_AVATAR_COLOR, normalizeAvatarColor } from '@/shared/Avatar';
import { BANNER_ASPECT_RATIO } from '@/features/profile/profileLinks';
import { UploadProgressModal } from '@/shared/UploadProgressModal';
import { formatMB } from '@/shared/lib/formatBytes';
import { AVATAR_MIME_TYPES, MAX_AVATAR_BYTES, MAX_PROFILE_LINK_LEN, MAX_PROFILE_LINKS } from '@/shared/types/protocol';
import { Button } from '@/shared/ui/primitives/button';

type ProfileCropTarget =
  | { field: 'avatar' | 'banner'; kind: 'file'; file: File; src: string }
  // A URL picked via "Usar URL" — routed through this SAME crop dialog
  // (instead of being applied directly) so it also goes through the
  // server's crop/animate-detect pipeline (see uploadProfileImage below),
  // which is what generates the freeze-until-speaking poster for an
  // animated GIF/WebP. react-easy-crop only reports crop coordinates here,
  // it never reads pixels into a <canvas>, so an external image never hits
  // a CORS/tainted-canvas issue (see ImageCropDialog.tsx's own comment).
  | { field: 'avatar' | 'banner'; kind: 'url'; url: string };


export function ProfileSettings() {
  const { state, updateProfile, uploadProfileImage } = useRoom();
  const [avatar, setAvatar] = useState(state.me.avatar);
  const [avatarPoster, setAvatarPoster] = useState(state.me.avatarPoster);
  const [avatarColor, setAvatarColor] = useState(normalizeAvatarColor(state.me.avatarColor) || DEFAULT_AVATAR_COLOR);
  const [displayName, setDisplayName] = useState(state.me.displayName);
  const [banner, setBanner] = useState(state.me.banner);
  const [bannerPoster, setBannerPoster] = useState(state.me.bannerPoster);
  const [bio, setBio] = useState(state.me.bio);
  const [profileLinks, setProfileLinks] = useState<string[]>(state.me.profileLinks.length ? state.me.profileLinks : ['']);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [avatarUploadProgress, setAvatarUploadProgress] = useState(0);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [uploadingBanner, setUploadingBanner] = useState(false);
  const [bannerUploadProgress, setBannerUploadProgress] = useState(0);
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [profileSaved, setProfileSaved] = useState(false);
  const avatarFileInputRef = useRef<HTMLInputElement | null>(null);
  const bannerFileInputRef = useRef<HTMLInputElement | null>(null);
  const [cropTarget, setCropTarget] = useState<ProfileCropTarget | null>(null);
  const [urlDialogField, setUrlDialogField] = useState<'avatar' | 'banner' | null>(null);
  // Set for the duration of the upload (cropTarget itself is cleared right
  // away, see handleCropConfirm) — drives the blocking UploadProgressModal
  // below so its title/description can tell a file upload (real byte
  // progress) apart from a "usar URL" one (server downloads it, so the
  // client-side progress stays indeterminate).
  const [activeUpload, setActiveUpload] = useState<{ field: 'avatar' | 'banner'; kind: 'file' | 'url' } | null>(null);


  // keeps the form in sync with the account whenever it changes (a profile
  // saved from another tab); the page mounting is what used to be "modal opened"
  useEffect(() => {
    setProfileSaved(false);
    setAvatar(state.me.avatar);
    setAvatarPoster(state.me.avatarPoster);
    setAvatarColor(normalizeAvatarColor(state.me.avatarColor) || DEFAULT_AVATAR_COLOR);
    setDisplayName(state.me.displayName);
    setBanner(state.me.banner);
    setBannerPoster(state.me.bannerPoster);
    setBio(state.me.bio);
    setProfileLinks(state.me.profileLinks.length ? state.me.profileLinks : ['']);
  }, [state.me.avatar, state.me.avatarPoster, state.me.avatarColor, state.me.banner, state.me.bannerPoster, state.me.bio, state.me.displayName, state.me.profileLinks]);

  useEffect(() => {
    if (!profileSaved) return;
    const timeout = window.setTimeout(() => setProfileSaved(false), 2200);
    return () => window.clearTimeout(timeout);
  }, [profileSaved]);


  function profileLinksForSubmit(): string[] {
    return profileLinks.map((link) => link.trim()).filter(Boolean);
  }

  function handleProfileSubmit(e: FormEvent) {
    e.preventDefault();
    updateProfile({ avatar, avatarPoster, avatarColor, displayName, banner, bannerPoster, bio, profileLinks: profileLinksForSubmit() });
    setProfileSaved(true);
  }

  function updateProfileLink(index: number, value: string) {
    setProfileLinks((prev) => prev.map((link, i) => (i === index ? value.slice(0, MAX_PROFILE_LINK_LEN) : link)));
  }

  function addProfileLink() {
    setProfileLinks((prev) => (prev.length >= MAX_PROFILE_LINKS ? prev : [...prev, '']));
  }

  function removeProfileLink(index: number) {
    setProfileLinks((prev) => {
      const next = prev.filter((_, i) => i !== index);
      return next.length ? next : [''];
    });
  }

  function handleFilePicked(field: 'avatar' | 'banner', e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const setError = field === 'avatar' ? setAvatarError : setBannerError;
    if (file.size > MAX_AVATAR_BYTES) {
      setError(`Arquivo muito grande (máximo ${formatMB(MAX_AVATAR_BYTES)}).`);
      return;
    }
    setError(null);
    setCropTarget({ field, kind: 'file', file, src: URL.createObjectURL(file) });
  }

  function handleUrlPicked(field: 'avatar' | 'banner', url: string) {
    setUrlDialogField(null);
    // Routed through the crop dialog like a file upload (not applied
    // directly) — see handleCropConfirm below for why.
    setCropTarget({ field, kind: 'url', url });
  }

  function closeCropDialog() {
    if (cropTarget?.kind === 'file') URL.revokeObjectURL(cropTarget.src);
    setCropTarget(null);
  }

  async function handleCropConfirm(crop: Area) {
    if (!cropTarget) return;
    const target = cropTarget;
    const { field } = target;
    const setUploading = field === 'avatar' ? setUploadingAvatar : setUploadingBanner;
    const setProgress = field === 'avatar' ? setAvatarUploadProgress : setBannerUploadProgress;
    const setError = field === 'avatar' ? setAvatarError : setBannerError;
    const profile = { avatar, avatarColor, displayName, banner, bio, profileLinks: profileLinksForSubmit() };
    setError(null);
    setProgress(0);
    setUploading(true);
    setActiveUpload({ field, kind: target.kind });
    closeCropDialog();
    try {
      // A picked URL is sent as a JSON body instead of raw file bytes —
      // uploadProfileImage/the server (/api/avatar) already accepts either
      // one identically, downloading the URL itself before the same
      // crop/animate-detect/poster pipeline a file upload goes through.
      const body = target.kind === 'file'
        ? target.file
        : new Blob([JSON.stringify({ url: target.url })], { type: 'application/json' });
      const url = await uploadProfileImage(field, body, crop, setProgress, profile);
      if (field === 'avatar') setAvatar(url); else setBanner(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : `Falha ao enviar ${field === 'avatar' ? 'a foto' : 'o banner'}.`);
    } finally {
      setUploading(false);
      setActiveUpload(null);
    }
  }

  function handleRemoveAvatar() {
    setAvatar('');
    setAvatarPoster('');
    updateProfile({ avatar: '', avatarPoster: '', avatarColor, displayName, banner, bannerPoster, bio, profileLinks: profileLinksForSubmit() });
  }

  function handleRemoveBanner() {
    setBanner('');
    setBannerPoster('');
    updateProfile({ avatar, avatarPoster, avatarColor, displayName, banner: '', bannerPoster: '', bio, profileLinks: profileLinksForSubmit() });
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={handleProfileSubmit} className="flex max-w-120 flex-col gap-3">
        <ProfileCard
          user={{
            id: state.me.id || 'preview',
            displayName: displayName || state.me.name,
            username: state.me.name,
            avatar, avatarColor, banner, bio,
            profileLinks: profileLinksForSubmit(),
            role: state.me.role,
          }}
          online
          onAvatarUpload={() => avatarFileInputRef.current?.click()}
          onAvatarUploadUrl={() => setUrlDialogField('avatar')}
          onAvatarRemove={handleRemoveAvatar}
          avatarUploading={uploadingAvatar}
          onBannerUpload={() => bannerFileInputRef.current?.click()}
          onBannerUploadUrl={() => setUrlDialogField('banner')}
          onBannerRemove={handleRemoveBanner}
          bannerUploading={uploadingBanner}
          onDisplayNameChange={setDisplayName}
          onBioChange={setBio}
          onAvatarColorChange={setAvatarColor}
          editableLinks={profileLinks}
          onLinkChange={updateProfileLink}
          onAddLink={addProfileLink}
          onRemoveLink={removeProfileLink}
        />
        <input
          ref={avatarFileInputRef}
          aria-label="Selecionar foto de perfil"
          type="file"
          accept={AVATAR_MIME_TYPES.join(',')}
          hidden
          onChange={(e) => handleFilePicked('avatar', e)}
        />
        <input
          ref={bannerFileInputRef}
          aria-label="Selecionar banner"
          type="file"
          accept={AVATAR_MIME_TYPES.join(',')}
          hidden
          onChange={(e) => handleFilePicked('banner', e)}
        />
        {avatarError && <p role="alert" className="text-label text-red">{avatarError}</p>}
        {bannerError && <p role="alert" className="text-label text-red">{bannerError}</p>}

        <p className="text-caption text-text-muted">
          PNG, JPEG, GIF ou WEBP, até {formatMB(MAX_AVATAR_BYTES)}. Foto e banner valem assim que você confirma o recorte; nome, cor, bio e links só depois de salvar.
        </p>
        <Button type="submit" size="sm" className="w-fit">
          {profileSaved && <Check size={15} />}
          <span>{profileSaved ? 'Perfil salvo' : 'Salvar perfil'}</span>
        </Button>
      </form>

      <ImageCropDialog
        open={!!cropTarget}
        imageSrc={cropTarget ? (cropTarget.kind === 'file' ? cropTarget.src : cropTarget.url) : null}
        aspect={cropTarget?.field === 'banner' ? BANNER_ASPECT_RATIO : 1}
        cropShape={cropTarget?.field === 'banner' ? 'rect' : 'round'}
        title={cropTarget?.field === 'banner' ? 'Recortar banner' : 'Recortar foto de perfil'}
        onCancel={closeCropDialog}
        onConfirm={handleCropConfirm}
      />

      <ImageUrlDialog
        open={urlDialogField !== null}
        title={urlDialogField === 'banner' ? 'URL do banner' : 'URL da foto de perfil'}
        onOpenChange={(next) => { if (!next) setUrlDialogField(null); }}
        onConfirm={(url) => handleUrlPicked(urlDialogField!, url)}
      />

      <UploadProgressModal
        open={activeUpload !== null}
        title={
          activeUpload?.kind === 'url'
            ? `Baixando ${activeUpload.field === 'banner' ? 'o banner' : 'a foto de perfil'}…`
            : `Enviando ${activeUpload?.field === 'banner' ? 'o banner' : 'a foto de perfil'}…`
        }
        description={activeUpload?.kind === 'url' ? 'Baixando e processando a imagem da URL — pode levar alguns segundos.' : undefined}
        progress={activeUpload?.kind === 'file' ? (activeUpload.field === 'banner' ? bannerUploadProgress : avatarUploadProgress) : undefined}
      />
    </div>
  );
}

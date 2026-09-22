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
import { describeProfileSaveError } from '@/features/profile/useProfileUpdate';

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
  const { state, updateProfile, uploadProfileImage, removeProfileImage } = useRoom();
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
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
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


  // Kept in THREE separate effects, not one watching every field: a confirmed
  // avatar upload only changes state.me.avatar/avatarPoster, and must not
  // reset an in-progress, unsaved edit to displayName/bio/links back to their
  // last-saved value just because it happened to land at the same time.
  // (Two tabs open, or a save from elsewhere, still wins over local text —
  // that conflict is the plano de configurações's draft model, not this one.)
  useEffect(() => {
    setAvatar(state.me.avatar);
    setAvatarPoster(state.me.avatarPoster);
  }, [state.me.avatar, state.me.avatarPoster]);
  useEffect(() => {
    setBanner(state.me.banner);
    setBannerPoster(state.me.bannerPoster);
  }, [state.me.banner, state.me.bannerPoster]);
  // profileLinks arrives fresh off the wire on EVERY confirmed profile change
  // (JSON deserializes a new array reference even when the content is
  // identical) — an image-only confirmation would otherwise still trip this
  // effect on that reference alone and wipe an unsaved text edit. Comparing
  // by a joined string instead of the array itself makes the dependency
  // reflect the actual content.
  const profileLinksKey = state.me.profileLinks.join('␟');
  useEffect(() => {
    setAvatarColor(normalizeAvatarColor(state.me.avatarColor) || DEFAULT_AVATAR_COLOR);
    setDisplayName(state.me.displayName);
    setBio(state.me.bio);
    setProfileLinks(state.me.profileLinks.length ? state.me.profileLinks : ['']);
    // NOT resetting `profileSaved` here: this effect also runs right after
    // OUR OWN save is confirmed (state.me just changed to match what we
    // sent), and would otherwise immediately clear the "Perfil salvo"
    // confirmation `handleProfileSubmit` just set. `profileSaved` is driven
    // exclusively by that handler and its own auto-clear timeout below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.me.avatarColor, state.me.displayName, state.me.bio, profileLinksKey]);

  useEffect(() => {
    if (!profileSaved) return;
    const timeout = window.setTimeout(() => setProfileSaved(false), 2200);
    return () => window.clearTimeout(timeout);
  }, [profileSaved]);


  function profileLinksForSubmit(): string[] {
    return profileLinks.map((link) => link.trim()).filter(Boolean);
  }

  async function handleProfileSubmit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaveError(null);
    setSaving(true);
    try {
      await updateProfile({ avatar, avatarPoster, avatarColor, displayName, banner, bannerPoster, bio, profileLinks: profileLinksForSubmit() });
      setProfileSaved(true);
    } catch (err) {
      setSaveError(describeProfileSaveError(err));
    } finally {
      setSaving(false);
    }
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
      // Sends only avatar/avatarPoster (or banner/bannerPoster) — never
      // displayName/bio/color/links, however they currently stand in this
      // form. The preview below updates once the server confirms it (via
      // state.me, picked up by the sync effect above), not from this call.
      await uploadProfileImage(field, body, crop, setProgress);
    } catch (err) {
      setError(describeProfileSaveError(err, `Falha ao enviar ${field === 'avatar' ? 'a foto' : 'o banner'}.`));
    } finally {
      setUploading(false);
      setActiveUpload(null);
    }
  }

  async function handleRemoveImage(field: 'avatar' | 'banner') {
    const setError = field === 'avatar' ? setAvatarError : setBannerError;
    setError(null);
    try {
      await removeProfileImage(field);
    } catch (err) {
      setError(describeProfileSaveError(err, `Não foi possível remover ${field === 'avatar' ? 'a foto' : 'o banner'}.`));
    }
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
          onAvatarRemove={() => void handleRemoveImage('avatar')}
          avatarUploading={uploadingAvatar}
          onBannerUpload={() => bannerFileInputRef.current?.click()}
          onBannerUploadUrl={() => setUrlDialogField('banner')}
          onBannerRemove={() => void handleRemoveImage('banner')}
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
        {saveError && <p role="alert" className="text-label text-red">{saveError}</p>}
        <Button type="submit" size="sm" className="w-fit" disabled={saving}>
          {profileSaved && !saving && <Check size={15} />}
          <span>{saving ? 'Salvando…' : profileSaved ? 'Perfil salvo' : 'Salvar perfil'}</span>
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

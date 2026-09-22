import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import type { Area } from 'react-easy-crop';
import { Check } from 'lucide-react';
import { useBlocker } from 'react-router';
import { ImageCropDialog } from './ImageCropDialog';
import { ImageUrlDialog } from '@/shared/ImageUrlDialog';
import { ProfileCard } from '@/features/profile/ProfileCard';
import { useRoom } from '@/state/RoomContext';
import { DEFAULT_AVATAR_COLOR, normalizeAvatarColor } from '@/shared/Avatar';
import { BANNER_ASPECT_RATIO } from '@/features/profile/profileLinks';
import { UploadProgressModal } from '@/shared/UploadProgressModal';
import { formatMB } from '@/shared/lib/formatBytes';
import { AVATAR_MIME_TYPES, MAX_AVATAR_BYTES } from '@/shared/types/protocol';
import { Button } from '@/shared/ui/primitives/button';
import { describeProfileSaveError } from '@/features/profile/useProfileUpdate';
import { useProfileDraft, normalizeProfileDraftFields } from './useProfileDraft';
import { UnsavedProfileChangesDialog } from './UnsavedProfileChangesDialog';

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
  const [banner, setBanner] = useState(state.me.banner);
  const [bannerPoster, setBannerPoster] = useState(state.me.bannerPoster);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [avatarUploadProgress, setAvatarUploadProgress] = useState(0);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [uploadingBanner, setUploadingBanner] = useState(false);
  const [bannerUploadProgress, setBannerUploadProgress] = useState(0);
  const [bannerError, setBannerError] = useState<string | null>(null);
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

  // Avatar/banner apply immediately (E2) and never join this draft — only
  // name/color/bio/links go through baseline/draft/saveState (plano
  // §9.2). profileLinksKey guards against the array's fresh reference on
  // every socket message (JSON deserializes a new one even with identical
  // content) turning into a spurious "external change".
  const profileLinksKey = state.me.profileLinks.join('␟');
  const baseline = useMemo(() => ({
    displayName: state.me.displayName,
    avatarColor: normalizeAvatarColor(state.me.avatarColor) || DEFAULT_AVATAR_COLOR,
    bio: state.me.bio,
    profileLinks: state.me.profileLinks.length ? state.me.profileLinks : [''],
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [state.me.displayName, state.me.avatarColor, state.me.bio, profileLinksKey]);

  const { draft, setField, dirty, saveState, error: saveError, conflict, save, discard, applyIncoming } = useProfileDraft({
    baseline,
    save: (fields) => updateProfile({
      avatar, avatarPoster, banner, bannerPoster,
      ...normalizeProfileDraftFields(fields),
    }),
  });
  const saving = saveState === 'saving';

  useEffect(() => {
    setAvatar(state.me.avatar);
    setAvatarPoster(state.me.avatarPoster);
  }, [state.me.avatar, state.me.avatarPoster]);
  useEffect(() => {
    setBanner(state.me.banner);
    setBannerPoster(state.me.bannerPoster);
  }, [state.me.banner, state.me.bannerPoster]);

  const [justSaved, setJustSaved] = useState(false);
  useEffect(() => {
    if (!justSaved) return;
    const timeout = window.setTimeout(() => setJustSaved(false), 2200);
    return () => window.clearTimeout(timeout);
  }, [justSaved]);

  async function handleSave() {
    try {
      await save();
      setJustSaved(true);
    } catch {
      // surfaced via `saveError` below — nothing else to do here
    }
  }

  function handleFormSubmit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    void handleSave();
  }

  // Leaving the Profile category (another settings tab, another page, the
  // browser's back/forward) with a dirty draft opens the 3-way prompt
  // instead of silently discarding it. Scoped to a real page change, not an
  // in-page hash jump (e.g. scrolling to a section keeps the same pathname).
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);

  async function handleSaveAndLeave() {
    try {
      await save();
      blocker.proceed?.();
    } catch {
      // dialog stays open, `saveError` shows why
    }
  }

  function updateProfileLink(index: number, value: string) {
    setField('profileLinks', draft.profileLinks.map((link, i) => (i === index ? value : link)));
  }

  function addProfileLink() {
    setField('profileLinks', [...draft.profileLinks, '']);
  }

  function removeProfileLink(index: number) {
    const next = draft.profileLinks.filter((_, i) => i !== index);
    setField('profileLinks', next.length ? next : ['']);
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
      // Sends only avatar/avatarPoster (or banner/bannerPoster) — never the
      // profile draft, whatever it currently holds. The preview below
      // updates once the server confirms it (via state.me, picked up by the
      // sync effect above), not from this call.
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

  const showBar = dirty || saveState !== 'idle' || justSaved;
  // justSaved wins even over a `dirty` that's only true because this test/
  // fixture render never round-trips state.me back through the reducer —
  // in the real app the baseline catches up in the same tick save() resolves.
  const barStatusText = saveState === 'error' ? saveError
    : saving ? 'Salvando…'
    : justSaved ? 'Perfil salvo.'
    : dirty ? 'Você tem alterações não salvas.'
    : '';

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={handleFormSubmit} className="flex max-w-120 flex-col gap-3">
        <ProfileCard
          user={{
            id: state.me.id || 'preview',
            displayName: draft.displayName || state.me.name,
            username: state.me.name,
            avatar, avatarColor: draft.avatarColor, banner, bio: draft.bio,
            profileLinks: normalizeProfileDraftFields(draft).profileLinks,
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
          onDisplayNameChange={(value) => setField('displayName', value)}
          onBioChange={(value) => setField('bio', value)}
          onAvatarColorChange={(value) => setField('avatarColor', value)}
          editableLinks={draft.profileLinks}
          onLinkChange={updateProfileLink}
          onAddLink={addProfileLink}
          onRemoveLink={removeProfileLink}
          fieldsDisabled={saving}
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

        {conflict && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-strong bg-bg-tertiary px-4 py-3 text-label text-text-secondary">
            <span>Este perfil foi atualizado em outro lugar enquanto você editava.</span>
            <Button type="button" variant="ghost" size="sm" onClick={applyIncoming}>
              <span>Usar valores salvos</span>
            </Button>
          </div>
        )}

        {showBar && (
          <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center justify-between gap-3 border-t border-strong bg-bg-modal/95 px-4 py-3 backdrop-blur @[520px]:-mx-6 @[520px]:px-6 @[960px]:-mx-8 @[960px]:px-8">
            <p role={saveState === 'error' ? 'alert' : undefined} className={saveState === 'error' ? 'text-label text-red' : 'text-label text-text-muted'}>
              {barStatusText}
            </p>
            <div className="flex gap-2">
              {dirty && !justSaved && (
                <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={discard}>
                  <span>Descartar</span>
                </Button>
              )}
              <Button type="submit" size="sm" disabled={saving}>
                {justSaved && <Check size={15} />}
                <span>{saving ? 'Salvando…' : justSaved ? 'Perfil salvo' : 'Salvar perfil'}</span>
              </Button>
            </div>
          </div>
        )}
      </form>

      <UnsavedProfileChangesDialog
        open={blocker.state === 'blocked'}
        saving={saving}
        error={saveError}
        onContinueEditing={() => blocker.reset?.()}
        onDiscardAndLeave={() => { discard(); blocker.proceed?.(); }}
        onSaveAndLeave={() => void handleSaveAndLeave()}
      />

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

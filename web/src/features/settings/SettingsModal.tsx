import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { Bell, HardDrive, IdCard, LogOut, Settings2, ShieldCheck, SlidersHorizontal, User, Volume2, VolumeX } from 'lucide-react';
import { ModerationTab } from './ModerationTab';
import { ImageCropDialog } from './ImageCropDialog';
import { ProfileCard } from '../profile/ProfileCard';
import { useRoom } from '../../state/RoomContext';
import { useAuth } from '../../state/AuthContext';
import { useMediaDevices } from './useMediaDevices';
import { requestNotificationPermission } from '../../shared/notifications';
import { DEFAULT_AVATAR_COLOR, normalizeAvatarColor } from '../../shared/Avatar';
import { UploadProgressBar } from '../../shared/UploadProgressBar';
import { SectionLabel, sectionLabelClass } from '../../shared/SectionLabel';
import { cn } from '@/shared/lib/utils';
import { formatMB } from '../../shared/lib/formatBytes';
import { AVATAR_MIME_TYPES, MAX_AVATAR_BYTES, MAX_PROFILE_LINK_LEN, MAX_PROFILE_LINKS } from '../../types/protocol';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsIndicator, TabsPanel, TabsTrigger } from '@/components/ui/tabs';

const settingsCardClass = 'flex flex-col gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-4';

function formatGB(bytes: number): string {
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

function DevicePicker({ label, room, kind }: { label: string; room: import('livekit-client').Room; kind: MediaDeviceKind }) {
  const { devices, activeDeviceId, permissionNeeded, selectDevice, requestPermission } = useMediaDevices(room, kind);

  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-body font-medium text-text-primary">{label}</Label>
      {permissionNeeded ? (
        <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => requestPermission()}>
          <span>Permitir acesso pra ver os nomes dos dispositivos</span>
        </Button>
      ) : (
        <Select value={activeDeviceId} onValueChange={(v) => v && selectDevice(v)} disabled={devices.length === 0}>
          <SelectTrigger className="w-full text-text-muted">
            <SelectValue>{() => devices.find((d) => d.deviceId === activeDeviceId)?.label || 'Padrao do sistema'}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {devices.map((d) => (
              <SelectItem key={d.deviceId} value={d.deviceId}>{d.label || d.deviceId}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <p className="select-none text-label text-text-muted">A troca vale na hora, mesmo durante uma chamada.</p>
    </div>
  );
}

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  const {
    state, updateProfile, uploadProfileImage, showStats, setShowStats,
    notifyVolume, setNotifyVolume, notificationsEnabled, setNotificationsEnabled, livekitRoom, storageUsage,
  } = useRoom();
  const { logout } = useAuth();
  const [avatar, setAvatar] = useState(state.me.avatar);
  const [avatarColor, setAvatarColor] = useState(normalizeAvatarColor(state.me.avatarColor) || DEFAULT_AVATAR_COLOR);
  const [displayName, setDisplayName] = useState(state.me.displayName);
  const [banner, setBanner] = useState(state.me.banner);
  const [bio, setBio] = useState(state.me.bio);
  const [profileLinks, setProfileLinks] = useState<string[]>(state.me.profileLinks.length ? state.me.profileLinks : ['']);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [avatarUploadProgress, setAvatarUploadProgress] = useState(0);
  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [uploadingBanner, setUploadingBanner] = useState(false);
  const [bannerUploadProgress, setBannerUploadProgress] = useState(0);
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [notificationsError, setNotificationsError] = useState<string | null>(null);
  const avatarFileInputRef = useRef<HTMLInputElement | null>(null);
  const bannerFileInputRef = useRef<HTMLInputElement | null>(null);
  const [cropTarget, setCropTarget] = useState<{ field: 'avatar' | 'banner'; src: string } | null>(null);

  useEffect(() => {
    if (open) {
      setAvatar(state.me.avatar);
      setAvatarColor(normalizeAvatarColor(state.me.avatarColor) || DEFAULT_AVATAR_COLOR);
      setDisplayName(state.me.displayName);
      setBanner(state.me.banner);
      setBio(state.me.bio);
      setProfileLinks(state.me.profileLinks.length ? state.me.profileLinks : ['']);
    }
  }, [open, state.me.avatar, state.me.avatarColor, state.me.banner, state.me.bio, state.me.displayName, state.me.profileLinks]);

  function handleVolumeChange(value: number | readonly number[]) {
    const v = Array.isArray(value) ? (value[0] ?? 0) : (value as number);
    setNotifyVolume(v / 100);
  }

  async function handleToggleNotifications(checked: boolean) {
    if (!checked) {
      setNotificationsError(null);
      setNotificationsEnabled(false);
      return;
    }
    if (typeof Notification === 'undefined') {
      setNotificationsError('Seu navegador nao suporta notificacoes.');
      return;
    }
    const permission = Notification.permission === 'default' ? await requestNotificationPermission() : Notification.permission;
    if (permission === 'granted') {
      setNotificationsError(null);
      setNotificationsEnabled(true);
    } else {
      setNotificationsError('Notificacoes bloqueadas. Permita o acesso nas configuracoes do navegador pra habilitar.');
    }
  }

  function profileLinksForSubmit(): string[] {
    return profileLinks.map((link) => link.trim()).filter(Boolean);
  }

  function handleProfileSubmit(e: FormEvent) {
    e.preventDefault();
    updateProfile({ avatar, avatarColor, displayName, banner, bio, profileLinks: profileLinksForSubmit() });
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
    setCropTarget({ field, src: URL.createObjectURL(file) });
  }

  function closeCropDialog() {
    if (cropTarget) URL.revokeObjectURL(cropTarget.src);
    setCropTarget(null);
  }

  async function handleCropConfirm(blob: Blob) {
    if (!cropTarget) return;
    const { field } = cropTarget;
    const setUploading = field === 'avatar' ? setUploadingAvatar : setUploadingBanner;
    const setProgress = field === 'avatar' ? setAvatarUploadProgress : setBannerUploadProgress;
    const setError = field === 'avatar' ? setAvatarError : setBannerError;
    setError(null);
    setProgress(0);
    setUploading(true);
    closeCropDialog();
    try {
      const url = await uploadProfileImage(field, blob, setProgress, { avatar, avatarColor, displayName, banner, bio, profileLinks: profileLinksForSubmit() });
      if (field === 'avatar') setAvatar(url); else setBanner(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : `Falha ao enviar ${field === 'avatar' ? 'a foto' : 'o banner'}.`);
    } finally {
      setUploading(false);
    }
  }

  function handleRemoveAvatar() {
    setAvatar('');
    updateProfile({ avatar: '', avatarColor, displayName, banner, bio, profileLinks: profileLinksForSubmit() });
  }

  function handleRemoveBanner() {
    setBanner('');
    updateProfile({ avatar, avatarColor, displayName, banner: '', bio, profileLinks: profileLinksForSubmit() });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="inset-0 h-full max-h-full w-full max-w-full translate-x-0 translate-y-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-none bg-bg-modal p-0 gap-0 md:inset-auto md:top-1/2 md:left-1/2 md:h-auto md:min-h-150 md:max-h-[90vh] md:w-full md:max-w-4xl md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-xl">
        <DialogHeader className="border-b border-white/10 px-4 pt-5 pb-2 pr-12 md:px-6 md:pr-12">
          <DialogTitle className="text-display font-bold text-text-primary">Ajustes</DialogTitle>
        </DialogHeader>
        <Tabs defaultValue="profile" orientation="vertical" className="min-h-0 min-w-0 flex-1 flex-col items-stretch md:flex-row">
          <TabsList className="h-auto w-full min-w-0 flex-none flex-row items-stretch gap-1 overflow-x-auto rounded-none border-b border-white/10 bg-transparent p-2 md:w-48 md:flex-col md:overflow-visible md:border-b-0 md:border-r md:p-3">
            <TabsIndicator className="rounded-lg bg-primary/12" />
            <TabsTrigger value="profile" className="flex-none justify-start gap-2 whitespace-nowrap px-2.5"><User size={16} /><span>Perfil</span></TabsTrigger>
            <TabsTrigger value="account" className="flex-none justify-start gap-2 whitespace-nowrap px-2.5"><IdCard size={16} /><span>Conta</span></TabsTrigger>
            <TabsTrigger value="av" className="flex-none justify-start gap-2 whitespace-nowrap px-2.5"><SlidersHorizontal size={16} /><span>Audio e video</span></TabsTrigger>
            <TabsTrigger value="notifications" className="flex-none justify-start gap-2 whitespace-nowrap px-2.5"><Bell size={16} /><span>Notificacoes</span></TabsTrigger>
            <TabsTrigger value="prefs" className="flex-none justify-start gap-2 whitespace-nowrap px-2.5"><Settings2 size={16} /><span>Preferencias</span></TabsTrigger>
            {state.me.role === 'admin' && (
              <TabsTrigger value="moderation" className="flex-none justify-start gap-2 whitespace-nowrap px-2.5"><ShieldCheck size={16} /><span>Moderacao</span></TabsTrigger>
            )}
          </TabsList>

          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4 md:p-6">
            <TabsPanel value="profile" className="flex flex-col gap-3">
              <p className="select-none text-label text-text-muted">
                Edite direto no seu perfil — o que voce ve aqui e exatamente o que os outros vao ver.
              </p>

              <form onSubmit={handleProfileSubmit} className="flex flex-col gap-3">
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
                  onAvatarRemove={handleRemoveAvatar}
                  avatarUploading={uploadingAvatar}
                  onBannerUpload={() => bannerFileInputRef.current?.click()}
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
                {uploadingAvatar && (
                  <div className="flex items-center gap-2">
                    <UploadProgressBar progress={avatarUploadProgress} />
                    <span className="flex-none text-caption tabular-nums text-text-muted">Enviando foto: {Math.round(avatarUploadProgress * 100)}%</span>
                  </div>
                )}
                {avatarError && <p className="text-label text-red">{avatarError}</p>}
                {uploadingBanner && (
                  <div className="flex items-center gap-2">
                    <UploadProgressBar progress={bannerUploadProgress} />
                    <span className="flex-none text-caption tabular-nums text-text-muted">Enviando banner: {Math.round(bannerUploadProgress * 100)}%</span>
                  </div>
                )}
                {bannerError && <p className="text-label text-red">{bannerError}</p>}

                <div className="flex items-center justify-between gap-2">
                  <p className="select-none text-caption text-text-muted">PNG, JPEG, GIF ou WEBP, até {formatMB(MAX_AVATAR_BYTES)}.</p>
                  <Button type="submit" size="sm" className="flex-none">
                    <span>Salvar perfil</span>
                  </Button>
                </div>
              </form>

              <ImageCropDialog
                open={!!cropTarget}
                imageSrc={cropTarget?.src ?? null}
                aspect={cropTarget?.field === 'banner' ? 3 : 1}
                cropShape={cropTarget?.field === 'banner' ? 'rect' : 'round'}
                title={cropTarget?.field === 'banner' ? 'Recortar banner' : 'Recortar foto de perfil'}
                onCancel={closeCropDialog}
                onConfirm={handleCropConfirm}
              />
            </TabsPanel>

            <TabsPanel value="account" className="flex flex-col gap-4">
              <div className={settingsCardClass}>
                <SectionLabel>Identificacao</SectionLabel>
                <div className="flex flex-col gap-1">
                  <Label className="text-label text-text-muted">Nome de usuario</Label>
                  <p className="select-none text-body text-text-primary">@{state.me.name}</p>
                  <p className="select-none text-caption text-text-muted">Fixo, nao pode ser trocado. O nome de exibicao (aba Perfil) e o que aparece pra todo mundo.</p>
                </div>
                {state.me.role === 'admin' && (
                  <span className="flex w-fit items-center gap-1 rounded-sm bg-primary/15 px-1.5 py-0.5 text-caption font-medium text-primary">
                    <ShieldCheck size={14} /> Admin
                  </span>
                )}
              </div>

              <div className={settingsCardClass}>
                <span className={cn(sectionLabelClass, 'flex items-center gap-1.5')}>
                  <HardDrive size={14} /> Armazenamento de anexos
                </span>
                <div className="h-2 w-full overflow-hidden rounded-full bg-bg-hover">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${storageUsage.maxBytes ? Math.min(100, (storageUsage.totalBytes / storageUsage.maxBytes) * 100) : 0}%` }}
                  />
                </div>
                <p className="select-none text-label text-text-muted">
                  {formatGB(storageUsage.totalBytes)} de {formatGB(storageUsage.maxBytes)} usados, {storageUsage.totalFiles} arquivo{storageUsage.totalFiles === 1 ? '' : 's'} enviado{storageUsage.totalFiles === 1 ? '' : 's'}.
                </p>
              </div>

              <div className={settingsCardClass}>
                <SectionLabel>Sessao</SectionLabel>
                <Button type="button" variant="outline" size="sm" className="w-fit text-red hover:bg-red/12" onClick={logout}>
                  <LogOut size={14} />
                  <span>Sair da conta</span>
                </Button>
              </div>
            </TabsPanel>

            <TabsPanel value="av" className="flex flex-col gap-4">
              <div className={settingsCardClass}>
                <DevicePicker label="Microfone" room={livekitRoom} kind="audioinput" />
              </div>

              <div className={settingsCardClass}>
                <DevicePicker label="Camera" room={livekitRoom} kind="videoinput" />
              </div>

              <div className={settingsCardClass}>
                <DevicePicker label="Alto-falante" room={livekitRoom} kind="audiooutput" />
              </div>
            </TabsPanel>

            <TabsPanel value="notifications" className="flex flex-col gap-4">
              <div className={settingsCardClass}>
                <div className="flex items-center justify-between gap-3">
                  <span className={cn(sectionLabelClass, 'flex items-center gap-1.5')}>
                    {notifyVolume === 0 ? <VolumeX size={14} /> : <Volume2 size={14} />} Volume das notificacoes
                  </span>
                  <span className="flex-none text-label tabular-nums text-text-muted">{Math.round(notifyVolume * 100)}%</span>
                </div>
                <Slider value={[Math.round(notifyVolume * 100)]} onValueChange={handleVolumeChange} min={0} max={100} />
                <p className="select-none text-label text-text-muted">
                  Mutar/desmutar, ensurdecer, entrar/sair da chamada, camera, tela e mensagem nova.
                </p>
              </div>

              <div className={settingsCardClass}>
                <div className="flex flex-row items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="select-none text-body font-medium text-text-primary">Notificacoes de mensagens</p>
                    <p className="select-none text-label text-text-muted">Avisa no sistema quando chegar mensagem numa conversa que voce nao esta vendo.</p>
                  </div>
                  <Switch
                    checked={notificationsEnabled}
                    onCheckedChange={handleToggleNotifications}
                    aria-label="Notificacoes de mensagens"
                    className="mt-0.5 flex-none"
                  />
                </div>
                {notificationsError && <p className="text-label text-red">{notificationsError}</p>}
              </div>
            </TabsPanel>

            <TabsPanel value="prefs" className="flex flex-col gap-4">
              <div className={cn(settingsCardClass, 'flex-row items-start justify-between gap-3')}>
                <div className="min-w-0">
                  <p className="select-none text-body font-medium text-text-primary">Mostrar estatisticas</p>
                  <p className="select-none text-label text-text-muted">Bitrate e tempo no ar no menu de cada transmissao.</p>
                </div>
                <Switch
                  checked={showStats}
                  onCheckedChange={setShowStats}
                  aria-label="Mostrar estatisticas"
                  className="mt-0.5 flex-none"
                />
              </div>
            </TabsPanel>

            {state.me.role === 'admin' && (
              <TabsPanel value="moderation">
                <ModerationTab />
              </TabsPanel>
            )}
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

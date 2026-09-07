import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { Check, HardDrive, Images, Link2, LogOut, Palette, Plus, Settings2, ShieldCheck, SlidersHorizontal, Trash2, Upload, User, Volume2, VolumeX } from 'lucide-react';
import { MediaTab } from './MediaTab';
import { ModerationTab } from './ModerationTab';
import { useRoom } from '../../state/RoomContext';
import { useAuth } from '../../state/AuthContext';
import { QUALITY_LABELS } from './useQualityPreference';
import type { Quality } from './useQualityPreference';
import { useMediaDevices } from './useMediaDevices';
import { requestNotificationPermission } from '../../shared/notifications';
import { Avatar, AVATAR_COLOR_OPTIONS, DEFAULT_AVATAR_COLOR, normalizeAvatarColor } from '../../shared/Avatar';
import { MAX_DISPLAY_NAME_LEN } from '../../shared/lib/displayName';
import { UploadProgressBar } from '../../shared/UploadProgressBar';
import { SectionLabel, sectionLabelClass } from '../../shared/SectionLabel';
import { cn } from '@/shared/lib/utils';
import { formatMB } from '../../shared/lib/formatBytes';
import { MAX_AVATAR_BYTES, MAX_BANNER_LEN, MAX_PROFILE_BIO_LEN, MAX_PROFILE_LINK_LEN, MAX_PROFILE_LINKS } from '../../types/protocol';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsIndicator, TabsPanel, TabsTrigger } from '@/components/ui/tabs';

const QUALITY_OPTIONS = Object.keys(QUALITY_LABELS) as Quality[];

const settingsCardClass = 'flex flex-col gap-2 rounded-md border border-strong bg-bg-tertiary p-4';

function formatGB(bytes: number): string {
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

/** A device dropdown (mic or camera) — shows a "Grant access" button in
 * place of the list when the browser hasn't granted permission yet
 * (empty/generic labels). */
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
    state, updateProfile, uploadAvatarFile, quality, setQuality, showStats, setShowStats,
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
  const avatarFileInputRef = useRef<HTMLInputElement | null>(null);

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
      setNotificationsEnabled(false);
      return;
    }
    // never request OS permission silently — only in direct response to
    // the user turning this on, same care useMediaDevices takes with mic/
    // camera permission (its "Grant access" button).
    if (typeof Notification === 'undefined') return;
    const permission = Notification.permission === 'default' ? await requestNotificationPermission() : Notification.permission;
    if (permission === 'granted') setNotificationsEnabled(true);
  }

  // true once a color OUTSIDE the curated presets was picked via the custom
  // color input below — drives which swatch shows the "selected" ring.
  const isCustomAvatarColor = !AVATAR_COLOR_OPTIONS.some((option) => option.value === avatarColor);

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

  async function handleAvatarFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allows picking the SAME file again later
    if (!file) return;
    if (file.size > MAX_AVATAR_BYTES) {
      setAvatarError(`Arquivo muito grande (máximo ${formatMB(MAX_AVATAR_BYTES)}).`);
      return;
    }
    setAvatarError(null);
    setAvatarUploadProgress(0);
    setUploadingAvatar(true);
    try {
      const url = await uploadAvatarFile(file, setAvatarUploadProgress, { avatarColor, displayName, banner, bio, profileLinks: profileLinksForSubmit() });
      setAvatar(url);
    } catch (err) {
      setAvatarError(err instanceof Error ? err.message : 'Falha ao enviar a foto.');
    } finally {
      setUploadingAvatar(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      {/* DialogContent's base already bundles `sm:max-w-sm` (384px) — only
          overriding the unprefixed max-w isn't enough, `sm:` still applies
          on any screen >=640px and wins by specificity, clipping content.
          Both must be overridden. */}
      {/* full-screen sheet below md (no room for a floating card + a
          left-hand tab column); reverts to the original centered card from
          md up. */}
      <DialogContent className="inset-0 h-full max-h-full w-full max-w-full translate-x-0 translate-y-0 grid-rows-[auto_1fr] overflow-hidden rounded-none bg-bg-modal p-0 gap-0 md:inset-auto md:top-1/2 md:left-1/2 md:h-auto md:min-h-130 md:max-h-[85vh] md:w-full md:max-w-3xl md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-xl">
        <DialogTitle className="border-b border-subtle px-4 pt-5 pb-2 text-display font-bold text-text-primary md:px-6">Ajustes</DialogTitle>
        <Tabs defaultValue="profile" orientation="vertical" className="min-h-0 flex-1 flex-col items-stretch md:flex-row">
          <TabsList className="h-auto w-full flex-none flex-row items-stretch gap-1 overflow-x-auto rounded-none bg-bg-primary p-2 md:w-44 md:flex-col md:overflow-visible md:p-3">
            <TabsIndicator />
            <TabsTrigger value="profile" className="flex-none justify-start gap-2 whitespace-nowrap px-2.5"><User size={16} /><span>Perfil</span></TabsTrigger>
            <TabsTrigger value="av" className="flex-none justify-start gap-2 whitespace-nowrap px-2.5"><SlidersHorizontal size={16} /><span>Audio e video</span></TabsTrigger>
            <TabsTrigger value="prefs" className="flex-none justify-start gap-2 whitespace-nowrap px-2.5"><Settings2 size={16} /><span>Preferencias</span></TabsTrigger>
            <TabsTrigger value="media" className="flex-none justify-start gap-2 whitespace-nowrap px-2.5"><Images size={16} /><span>Midias</span></TabsTrigger>
            {/* only admins see this tab — the server also revalidates the
                role on EVERY action (moderation.ts), this check just
                avoids showing UI to someone who can't use it. */}
            {state.me.role === 'admin' && (
              <TabsTrigger value="moderation" className="flex-none justify-start gap-2 whitespace-nowrap px-2.5"><ShieldCheck size={16} /><span>Moderacao</span></TabsTrigger>
            )}
          </TabsList>

          <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
            <TabsPanel value="profile" className="flex flex-col gap-6">
              <div className="flex items-center gap-3">
                <Avatar id={state.me.id || 'preview'} name={displayName || state.me.name} avatar={avatar} avatarColor={avatarColor} size={48} />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <p className="truncate text-title font-semibold text-text-primary">{displayName || state.me.name}</p>
                  <p className="truncate text-label text-text-muted">@{state.me.name}</p>
                  {state.me.role === 'admin' && (
                    <span className="flex w-fit items-center gap-1 rounded-sm bg-blurple/15 px-1.5 py-0.5 text-caption font-medium text-blurple">
                      <ShieldCheck size={14} /> Admin
                    </span>
                  )}
                </div>
              </div>

              <form onSubmit={handleProfileSubmit} className={settingsCardClass}>
                <SectionLabel>Nome de exibição</SectionLabel>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="settingsDisplayName" className="text-label text-text-muted">Como voce aparece pra todo mundo</Label>
                  <Input
                    id="settingsDisplayName"
                    maxLength={MAX_DISPLAY_NAME_LEN}
                    placeholder={state.me.name}
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                  />
                  <p className="select-none text-caption text-text-muted">
                    Nao precisa ser unico e pode trocar quando quiser. Deixe em branco pra usar seu nome de usuario (@{state.me.name}).
                  </p>
                </div>

                <SectionLabel>Foto de perfil</SectionLabel>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="settingsAvatar" className="text-label text-text-muted">URL de uma imagem (opcional)</Label>
                  <Input
                    id="settingsAvatar"
                    maxLength={500}
                    placeholder="https://..."
                    value={avatar}
                    onChange={(e) => setAvatar(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label className="text-label text-text-muted">Cor do fundo</Label>
                  <div className="flex flex-wrap gap-2">
                    {AVATAR_COLOR_OPTIONS.map((option) => {
                      const selected = avatarColor === option.value;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          aria-label={`Usar ${option.label}`}
                          aria-pressed={selected}
                          onClick={() => setAvatarColor(option.value)}
                          className={cn(
                            'relative h-8 w-8 rounded-full border transition focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                            selected ? 'border-text-primary ring-2 ring-ring/50 ring-offset-2 ring-offset-bg-tertiary' : 'border-strong hover:border-text-muted'
                          )}
                          style={{ background: option.css }}
                        >
                          {selected && <Check size={16} className="absolute inset-0 m-auto text-white drop-shadow" />}
                        </button>
                      );
                    })}
                    {/* custom color, beyond the presets above — a native
                        color picker reshaped into the same circular swatch
                        (see index.css#.avatar-color-custom-input). Shows a
                        neutral gray + palette icon until a non-preset color
                        is actually picked, so it doesn't look like a
                        duplicate of one of the presets. */}
                    <label
                      title="Cor personalizada"
                      className={cn(
                        'relative flex h-8 w-8 items-center justify-center rounded-full border transition focus-within:outline-none focus-within:ring-3 focus-within:ring-ring/50',
                        isCustomAvatarColor ? 'border-text-primary ring-2 ring-ring/50 ring-offset-2 ring-offset-bg-tertiary' : 'border-strong hover:border-text-muted'
                      )}
                    >
                      <input
                        type="color"
                        aria-label="Escolher cor personalizada"
                        aria-pressed={isCustomAvatarColor}
                        value={isCustomAvatarColor ? avatarColor : '#6b7280'}
                        onChange={(e) => setAvatarColor(e.target.value)}
                        className="avatar-color-custom-input h-8 w-8 cursor-pointer"
                      />
                      <span className="pointer-events-none absolute inset-0 m-auto flex h-4 w-4 items-center justify-center">
                        {isCustomAvatarColor ? <Check size={16} className="text-white drop-shadow" /> : <Palette size={14} className="text-white/90 drop-shadow" />}
                      </span>
                    </label>
                  </div>
                </div>

                <SectionLabel>Banner</SectionLabel>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="settingsBanner" className="text-label text-text-muted">URL de uma imagem horizontal (opcional)</Label>
                  <Input
                    id="settingsBanner"
                    maxLength={MAX_BANNER_LEN}
                    placeholder="https://..."
                    value={banner}
                    onChange={(e) => setBanner(e.target.value)}
                  />
                </div>

                <SectionLabel>Bio</SectionLabel>
                <div className="flex flex-col gap-2">
                  <Label htmlFor="settingsBio" className="text-label text-text-muted">Um resumo curto sobre voce</Label>
                  <Textarea
                    id="settingsBio"
                    maxLength={MAX_PROFILE_BIO_LEN}
                    value={bio}
                    onChange={(e) => setBio(e.target.value)}
                    rows={4}
                    className="resize-none bg-bg-textarea text-body"
                  />
                  <p className="select-none text-caption text-text-muted">{bio.length}/{MAX_PROFILE_BIO_LEN}</p>
                </div>

                <SectionLabel>Links</SectionLabel>
                <div className="flex flex-col gap-2">
                  {profileLinks.map((link, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <Link2 size={15} className="flex-none text-text-muted" />
                      <Input
                        aria-label={`Link ${index + 1}`}
                        maxLength={MAX_PROFILE_LINK_LEN}
                        placeholder="https://..."
                        value={link}
                        onChange={(e) => updateProfileLink(index, e.target.value)}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Remover link"
                        className="flex-none text-text-muted hover:bg-red/12 hover:text-red"
                        onClick={() => removeProfileLink(index)}
                      >
                        <Trash2 size={15} />
                      </Button>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-fit"
                    disabled={profileLinks.length >= MAX_PROFILE_LINKS}
                    onClick={addProfileLink}
                  >
                    <Plus size={14} />
                    <span>Adicionar link</span>
                  </Button>
                </div>
                <div className="flex items-center gap-2">
                  <Button type="submit" size="sm">
                    <span>Salvar perfil</span>
                  </Button>
                  <input
                    ref={avatarFileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/gif,image/webp"
                    hidden
                    onChange={handleAvatarFileChange}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={uploadingAvatar}
                    onClick={() => avatarFileInputRef.current?.click()}
                  >
                    <Upload size={14} />
                    <span>{uploadingAvatar ? 'Enviando…' : 'Enviar do computador'}</span>
                  </Button>
                </div>
                {uploadingAvatar && (
                  <div className="flex items-center gap-2">
                    <UploadProgressBar progress={avatarUploadProgress} />
                    <span className="flex-none text-caption tabular-nums text-text-muted">{Math.round(avatarUploadProgress * 100)}%</span>
                  </div>
                )}
                {avatarError && <p className="text-label text-red">{avatarError}</p>}
                <p className="select-none text-caption text-text-muted">PNG, JPEG, GIF ou WEBP, até {formatMB(MAX_AVATAR_BYTES)}.</p>
              </form>

              <div className={settingsCardClass}>
                <SectionLabel>Conta</SectionLabel>
                <Button type="button" variant="outline" size="sm" className="w-fit text-red hover:bg-red/12" onClick={logout}>
                  <LogOut size={14} />
                  <span>Sair da conta</span>
                </Button>
              </div>
            </TabsPanel>

            <TabsPanel value="av" className="flex flex-col gap-4">
              <div className={settingsCardClass}>
                <Label className="text-body font-medium text-text-primary">Qualidade de envio</Label>
                <Select value={quality} onValueChange={(v) => setQuality(v as Quality)} disabled={state.me.sharing}>
                  <SelectTrigger className="w-full text-text-muted">
                    <SelectValue>{() => QUALITY_LABELS[quality]}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {QUALITY_OPTIONS.map((q) => (
                      <SelectItem key={q} value={q}>{QUALITY_LABELS[q]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="select-none text-label text-text-muted">
                  {state.me.sharing ? 'Para trocar, pare o compartilhamento atual primeiro.' : 'Vale a partir do proximo compartilhamento.'}
                </p>
              </div>

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

            <TabsPanel value="prefs" className="flex flex-col gap-4">
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

              <div className={cn(settingsCardClass, 'flex-row items-start justify-between gap-3')}>
                <div className="min-w-0">
                  <p className="select-none text-body font-medium text-text-primary">Notificacoes de mensagens</p>
                  <p className="select-none text-label text-text-muted">Avisa no sistema quando chegar mensagem em um canal que voce nao esta vendo.</p>
                </div>
                <Switch
                  checked={notificationsEnabled}
                  onCheckedChange={handleToggleNotifications}
                  aria-label="Notificacoes de mensagens"
                  className="mt-0.5 flex-none"
                />
              </div>

              <div className={settingsCardClass}>
                <span className={cn(sectionLabelClass, 'flex items-center gap-1.5')}>
                  <HardDrive size={14} /> Armazenamento de anexos
                </span>
                <div className="h-2 w-full overflow-hidden rounded-full bg-bg-hover">
                  <div
                    className="h-full rounded-full bg-blurple transition-all"
                    style={{ width: `${storageUsage.maxBytes ? Math.min(100, (storageUsage.totalBytes / storageUsage.maxBytes) * 100) : 0}%` }}
                  />
                </div>
                <p className="select-none text-label text-text-muted">
                  {formatGB(storageUsage.totalBytes)} de {formatGB(storageUsage.maxBytes)} usados, {storageUsage.totalFiles} arquivo{storageUsage.totalFiles === 1 ? '' : 's'} enviado{storageUsage.totalFiles === 1 ? '' : 's'}.
                </p>
              </div>
            </TabsPanel>

            <TabsPanel value="media">
              <MediaTab />
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

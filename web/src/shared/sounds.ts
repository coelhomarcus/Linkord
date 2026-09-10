
const SOUND_FILES = {
  muted: '/sounds/muted.mp3',
  unmuted: '/sounds/non-muted.mp3',
  deafened: '/sounds/deaf.mp3',
  undeafened: '/sounds/non-deaf.mp3',
  userLeave: '/sounds/user-leave.mp3',
  incomingUser: '/sounds/incoming-user.mp3',
  newMessage: '/sounds/new-message.mp3',
  screenshare: '/sounds/screenshare.mp3',
  camera: '/sounds/camera.mp3',
} as const;

export type SoundName = keyof typeof SOUND_FILES;

const preloaded = new Map<SoundName, HTMLAudioElement>();

let volume = 1;

export function setVolume(v: number): void {
  volume = Math.max(0, Math.min(1, v));
  for (const audio of preloaded.values()) audio.volume = volume;
}

export function preloadSounds(): void {
  for (const name of Object.keys(SOUND_FILES) as SoundName[]) {
    if (preloaded.has(name)) continue;
    const audio = new Audio(SOUND_FILES[name]);
    audio.preload = 'auto';
    audio.load();
    preloaded.set(name, audio);
  }
}

export function playSound(name: SoundName): void {
  const warm = preloaded.get(name);
  const audio = warm && warm.paused ? warm : new Audio(SOUND_FILES[name]);
  if (audio === warm) audio.currentTime = 0;
  audio.volume = volume;
  audio.play().catch(() => {});
}

/** App sound effects — files live in web/public/sounds/. */

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

// one "warm" instance per sound, with the file already fetched/decoded —
// without this, the FIRST play() of each sound would have to fetch the mp3
// over the network right then, with a noticeable delay exactly when it
// matters most (e.g. someone joining the call). Preloading doesn't hit the
// browser's autoplay policy — only a real play() does; fetching/decoding
// the file ahead of time is always allowed.
const preloaded = new Map<SoundName, HTMLAudioElement>();

// global effects volume (0..1) — a module, not React state: playSound is
// also called from outside components (useMicrophone.ts), so there's no
// way to pass the current value as a parameter each call. Whoever changes
// the volume (RoomProvider, reflecting the saved preference) calls
// setVolume(); playSound always reads the latest value from here.
let volume = 1;

export function setVolume(v: number): void {
  volume = Math.max(0, Math.min(1, v));
  // already-preloaded instances also need the new value — otherwise the
  // FIRST play() of each sound (which reuses the warm instance) would
  // always come out at whatever volume was set when preloadSounds() ran.
  for (const audio of preloaded.values()) audio.volume = volume;
}

/** Prepares all effects at once — called once when the room mounts
 * (RoomProvider). Idempotent, safe to call again. */
export function preloadSounds(): void {
  for (const name of Object.keys(SOUND_FILES) as SoundName[]) {
    if (preloaded.has(name)) continue;
    const audio = new Audio(SOUND_FILES[name]);
    audio.preload = 'auto';
    audio.load();
    preloaded.set(name, audio);
  }
}

/** Never throws — before the page's first user gesture, the browser may
 * block play() (autoplay policy); that's expected for the "someone
 * joined/left"/"new message" sounds on a freshly opened tab, so it just
 * ignores it silently instead of spamming the console. */
export function playSound(name: SoundName): void {
  const warm = preloaded.get(name);
  // reuses the preloaded instance in the common case (it isn't playing
  // right now); if it's already in use (the same sound triggered twice in
  // quick succession), creates a second one — the file is already in the
  // preload's HTTP cache, so it still plays instantly, just without
  // cutting off the one already playing.
  const audio = warm && warm.paused ? warm : new Audio(SOUND_FILES[name]);
  if (audio === warm) audio.currentTime = 0;
  audio.volume = volume;
  audio.play().catch(() => {});
}

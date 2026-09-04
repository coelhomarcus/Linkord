/** Efeitos sonoros da app — arquivos em web/public/sounds/. */

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

// instancia "quente" por som, ja com o arquivo buscado/decodificado — sem
// isso, o PRIMEIRO play() de cada som teria que buscar o mp3 pela rede na
// hora, com um atraso perceptivel bem no momento que mais importa (ex.:
// alguem entrando na chamada). Preload nao esbarra na politica de autoplay
// do navegador — so play() de verdade esbarra nisso, buscar/decodificar o
// arquivo com antecedencia e sempre permitido.
const preloaded = new Map<SoundName, HTMLAudioElement>();

// Volume global dos efeitos (0..1) — modulo, nao estado de React: playSound
// e chamado de fora de componentes tambem (useMicrophone.ts), entao nao ha
// como passar o valor atual por parametro em cada chamada. Quem muda o
// volume (RoomProvider, refletindo a preferencia salva) chama setVolume();
// playSound sempre le o valor mais recente daqui.
let volume = 1;

export function setVolume(v: number): void {
  volume = Math.max(0, Math.min(1, v));
  // instancias ja pre-carregadas tambem precisam do valor novo — sem isso,
  // o PRIMEIRO play() de cada som (que reaproveita a instancia quente)
  // sairia sempre no volume de quando preloadSounds() rodou.
  for (const audio of preloaded.values()) audio.volume = volume;
}

/** Prepara todos os efeitos de uma vez — chamado uma vez ao montar a sala
 * (RoomProvider). Idempotente, seguro chamar de novo. */
export function preloadSounds(): void {
  for (const name of Object.keys(SOUND_FILES) as SoundName[]) {
    if (preloaded.has(name)) continue;
    const audio = new Audio(SOUND_FILES[name]);
    audio.preload = 'auto';
    audio.load();
    preloaded.set(name, audio);
  }
}

/** Nunca lanca — antes do primeiro gesto do usuario na pagina o navegador
 * pode bloquear o play() (autoplay policy); isso e esperado pros sons de
 * "outra pessoa entrou/saiu"/"mensagem nova" numa aba recem-aberta, entao
 * so ignora em silencio em vez de poluir o console. */
export function playSound(name: SoundName): void {
  const warm = preloaded.get(name);
  // reaproveita a instancia pre-carregada no caso comum (ela nao esta
  // tocando agora); se ja estiver em uso (dois toques do mesmo som quase
  // juntos), cria uma segunda — o arquivo ja esta no cache HTTP do preload,
  // entao ainda sai na hora, so sem cortar a que ja estava tocando.
  const audio = warm && warm.paused ? warm : new Audio(SOUND_FILES[name]);
  if (audio === warm) audio.currentTime = 0;
  audio.volume = volume;
  audio.play().catch(() => {});
}

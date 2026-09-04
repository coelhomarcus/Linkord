/** Volume por pessoa/transmissao na chamada (mic ou audio de tela
 * compartilhada), persistido no localStorage — sem isso, todo audio remoto
 * volta pro maximo a cada reload (ver ParticipantAudioLayer/TileMenu).
 * Chave: userId (estavel entre reconexoes/abas) pro mic, `${userId}:screen`
 * pro audio de tela — mesmo esquema de sufixo que audioKey/audioRegistry ja
 * usam, so trocando participantId (identity do LiveKit, muda a cada conexao)
 * por userId. */

const CALL_VOLUME_KEY = 'ss-call-volumes';

function loadAll(): Record<string, number> {
  try {
    const raw = localStorage.getItem(CALL_VOLUME_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function loadCallVolume(key: string): number {
  const v = loadAll()[key];
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1;
}

export function saveCallVolume(key: string, value: number): void {
  const all = loadAll();
  all[key] = value;
  localStorage.setItem(CALL_VOLUME_KEY, JSON.stringify(all));
}

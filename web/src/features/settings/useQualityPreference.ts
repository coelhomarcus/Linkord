/** Bitrate de envio (tela e camera), persistido no localStorage — separado do
 * perfil (chave propria, ss-quality) porque e uma preferencia tecnica, nao de
 * identidade. */

export type Quality = 'standard' | 'reduced' | 'minimum';

/** Formato de VideoEncoding do livekit-client — declarado aqui (sem importar
 * a lib nesta pasta) pra manter settings/ isolado do resto das features. */
export interface QualityEncoding {
  maxBitrate: number;
  maxFramerate: number;
}

export const QUALITY_ENCODINGS: Record<Quality, QualityEncoding> = {
  standard: { maxBitrate: 2_500_000, maxFramerate: 30 },
  reduced: { maxBitrate: 1_000_000, maxFramerate: 24 },
  minimum: { maxBitrate: 500_000, maxFramerate: 15 },
};

export const QUALITY_LABELS: Record<Quality, string> = {
  standard: 'Padrão (2,5 Mbps)',
  reduced: 'Reduzida (1 Mbps)',
  minimum: 'Mínima (500 Kbps)',
};

const KEY = 'ss-quality';

export function loadQuality(): Quality {
  const v = localStorage.getItem(KEY);
  return v === 'reduced' || v === 'minimum' ? v : 'standard';
}

export function saveQuality(q: Quality): void {
  localStorage.setItem(KEY, q);
}

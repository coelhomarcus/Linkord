/** Um "tile" agora e por FONTE de midia, nao por participante — alguem
 * compartilhando tela e camera ao mesmo tempo vira dois retangulos
 * separados (estilo Discord), nao um sobreposto ao outro. */
export type TileKind = 'screen' | 'camera' | 'avatar';

export interface TileDescriptor {
  /** `${participantId}:${kind}` — unico, usado como key do React e como
   * alvo de foco/menu (da pra focar especificamente a tela OU a camera de
   * alguem). */
  key: string;
  participantId: string;
  kind: TileKind;
}

export function tileKey(participantId: string, kind: TileKind): string {
  return `${participantId}:${kind}`;
}

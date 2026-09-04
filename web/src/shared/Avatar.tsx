import { Avatar as AvatarRoot, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

// paleta do Discord (sem o amarelo: texto branco em cima dele fica ilegivel) —
// referencia os tokens de index.css em vez de repetir os hex
const AVATAR_COLORS = ['var(--color-blurple)', 'var(--color-green)', 'var(--color-red)', 'var(--color-fuchsia)'];

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const a = parts[0][0] || '';
  const b = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (a + b).toUpperCase();
}
// exportado pra outros lugares (ex.: cursor de alguem no quadro) usarem a
// mesma cor do avatar da pessoa, em vez de sortear uma cor a toa
export function colorFor(id: string): string {
  // guarda defensiva: `id` "deveria" ser sempre uma string de verdade (o tipo
  // diz isso), mas message.id vem do authorId da mensagem, que vira NULL
  // quando a conta de quem mandou e apagada (ver server/moderation.js e
  // ChatMessage.id em protocol.ts) — sem isso, `null.length` derrubava o
  // React inteiro (nao so aquele avatar) pra qualquer um abrindo um canal
  // com uma mensagem de alguem que foi apagado.
  if (!id) return AVATAR_COLORS[0];
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

interface AvatarProps {
  id: string;
  name: string;
  avatar: string;
  size: number;
}

/** O Avatar do shadcn (Base UI por baixo) ja rastreia o carregamento da
 * imagem e mostra o fallback sozinho em caso de erro ou URL vazia — nao
 * precisa mais do useState/onError manual que a versao anterior tinha. */
export function Avatar({ id, name, avatar, size }: AvatarProps) {
  return (
    <AvatarRoot style={{ width: size, height: size }}>
      {avatar && <AvatarImage src={avatar} alt="" />}
      <AvatarFallback
        className="font-bold text-white"
        style={{ background: colorFor(id), fontSize: Math.round(size * 0.4) }}
      >
        {initialsOf(name)}
      </AvatarFallback>
    </AvatarRoot>
  );
}

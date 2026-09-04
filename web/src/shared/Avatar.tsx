import { Avatar as AvatarRoot, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

// Discord's palette (no yellow: white text on it is illegible) — references
// index.css's tokens instead of repeating the hex values
const AVATAR_COLORS = ['var(--color-blurple)', 'var(--color-green)', 'var(--color-red)', 'var(--color-fuchsia)'];

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const a = parts[0][0] || '';
  const b = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (a + b).toUpperCase();
}
// exported so other places can reuse a person's avatar color instead of
// picking a random one
export function colorFor(id: string): string {
  // defensive guard: `id` "should" always be a real string (the type says
  // so), but a message's authorId becomes NULL when the sender's account
  // is deleted (see server/src/modules/moderation.ts and ChatMessage.id in
  // protocol.ts) — without this, `null.length` crashed all of React (not
  // just that avatar) for anyone opening a channel with a message from a
  // deleted account.
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

/** shadcn's Avatar (Base UI underneath) already tracks image loading and
 * shows the fallback on its own on error or an empty URL — no longer needs
 * the manual useState/onError the previous version had. */
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

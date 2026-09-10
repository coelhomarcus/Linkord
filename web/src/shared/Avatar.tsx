import { Avatar as AvatarRoot, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

export const AVATAR_COLOR_OPTIONS = [
  { value: 'blurple', label: 'Blurple', css: 'var(--color-blurple)' },
  { value: 'green', label: 'Verde', css: 'var(--color-green)' },
  { value: 'red', label: 'Vermelho', css: 'var(--color-red)' },
  { value: 'fuchsia', label: 'Fuchsia', css: 'var(--color-fuchsia)' },
  { value: 'orange', label: 'Laranja', css: 'var(--color-orange)' },
  { value: 'purple', label: 'Roxo', css: 'var(--color-purple)' },
  { value: 'teal', label: 'Verde-azulado', css: 'var(--color-teal)' },
  { value: 'blue', label: 'Azul', css: 'var(--color-blue)' },
] as const;

export type AvatarColorValue = (typeof AVATAR_COLOR_OPTIONS)[number]['value'];
export const DEFAULT_AVATAR_COLOR: AvatarColorValue = AVATAR_COLOR_OPTIONS[0].value;

const AVATAR_COLORS = AVATAR_COLOR_OPTIONS.map((c) => c.css);
const AVATAR_COLOR_BY_VALUE = new Map<string, string>(AVATAR_COLOR_OPTIONS.map((c) => [c.value, c.css]));

const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;

export function normalizeAvatarColor(value: unknown): AvatarColorValue | string | '' {
  const raw = String(value == null ? '' : value).trim();
  if (AVATAR_COLOR_BY_VALUE.has(raw)) return raw as AvatarColorValue;
  return HEX_COLOR_RE.test(raw) ? raw.toLowerCase() : '';
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const a = parts[0][0] || '';
  const b = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (a + b).toUpperCase();
}
function fallbackColorFor(id: string): string {
  if (!id) return AVATAR_COLORS[0];
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export function colorFor(id: string, avatarColor?: string | null): string {
  const normalized = normalizeAvatarColor(avatarColor);
  if (!normalized) return fallbackColorFor(id);
  return AVATAR_COLOR_BY_VALUE.get(normalized) ?? normalized;
}

interface AvatarProps {
  id: string;
  name: string;
  avatar: string;
  avatarColor?: string | null;
  size: number;
}

export function Avatar({ id, name, avatar, avatarColor, size }: AvatarProps) {
  return (
    <AvatarRoot style={{ width: size, height: size }}>
      {avatar && <AvatarImage src={avatar} alt="" />}
      <AvatarFallback
        className="font-bold text-white"
        style={{ background: colorFor(id, avatarColor), fontSize: Math.round(size * 0.4) }}
      >
        {initialsOf(name)}
      </AvatarFallback>
    </AvatarRoot>
  );
}

import { Plus } from 'lucide-react';
import { cn } from '@/shared/lib/utils';

// A short fixed set shown first, instead of mounting the full picker (and
// triggering its emoji-dataset fetch, see shared/ui/primitives/emoji-picker.tsx)
// on every single open — most reactions are one of these anyway. The full
// picker only mounts once "+" is actually clicked.
export const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'] as const;

export function QuickReactionRow({ onPick, onMore, className }: { onPick: (emoji: string) => void; onMore: () => void; className?: string }) {
  return (
    <div className={cn('flex items-center gap-1', className)}>
      {QUICK_REACTIONS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          onClick={() => onPick(emoji)}
          aria-label={`Reagir com ${emoji}`}
          className="rounded-md p-1.5 text-[20px] leading-none transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {emoji}
        </button>
      ))}
      <button
        type="button"
        onClick={onMore}
        aria-label="Mais emojis"
        className="rounded-md p-1.5 text-text-muted transition-colors hover:bg-muted hover:text-text-primary focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <Plus size={18} />
      </button>
    </div>
  );
}

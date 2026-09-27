import { useState } from 'react';
import { Users } from 'lucide-react';
import { Avatar } from '@/shared/Avatar';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/ui/primitives/dialog';
import { cn } from '@/shared/lib/utils';
import type { PublicUser, ReactionEmoji } from '@/shared/types/protocol';

const REMOVED_USER = 'Usuário removido';

function namesOf(userIds: string[], allUsers: Map<string, PublicUser>, myUserId: string | null): string[] {
  return userIds.map((id) => (id === myUserId ? 'Você' : allUsers.get(id)?.displayName ?? REMOVED_USER));
}

/** "Ana, Bia e mais 3" — the hover summary; the dialog has everyone. */
function summarize(names: string[]): string {
  if (names.length <= 3) return names.join(', ');
  return `${names.slice(0, 3).join(', ')} e mais ${names.length - 3}`;
}

interface MessageReactionsProps {
  reactions: Partial<Record<ReactionEmoji, string[]>>;
  myUserId: string | null;
  allUsers: Map<string, PublicUser>;
  onToggle: (emoji: ReactionEmoji) => void;
}

export function MessageReactions({ reactions, myUserId, allUsers, onToggle }: MessageReactionsProps) {
  const [participantsOpen, setParticipantsOpen] = useState(false);
  const entries = (Object.entries(reactions) as [ReactionEmoji, string[]][]).filter(([, userIds]) => userIds?.length);
  const [activeEmoji, setActiveEmoji] = useState<ReactionEmoji | null>(null);
  if (!entries.length) return null;
  const shownEmoji = activeEmoji && reactions[activeEmoji]?.length ? activeEmoji : entries[0]![0];

  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      {entries.map(([emoji, userIds]) => {
        const mine = !!myUserId && userIds.includes(myUserId);
        const names = namesOf(userIds, allUsers, myUserId);
        return (
          <button
            key={emoji}
            type="button"
            aria-pressed={mine}
            aria-label={`${mine ? 'Remover' : 'Adicionar'} reação ${emoji} (${userIds.length}): ${summarize(names)}`}
            title={summarize(names)}
            onClick={() => onToggle(emoji)}
            className={cn(
              'flex h-6 items-center gap-1 rounded-full border px-1.5 text-label transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
              mine ? 'border-primary/50 bg-primary/15 text-text-primary' : 'border-white/10 bg-white/[0.04] text-text-secondary hover:bg-white/[0.08]'
            )}
          >
            <span>{emoji}</span>
            {/* fixed box so a count going 9 → 10 doesn't shift the chips */}
            <span className="min-w-[1ch] tabular-nums">{userIds.length}</span>
          </button>
        );
      })}
      <button
        type="button"
        aria-label="Ver quem reagiu"
        title="Ver quem reagiu"
        onClick={() => { setActiveEmoji(null); setParticipantsOpen(true); }}
        className="grid size-6 place-items-center rounded-full text-text-muted hover:bg-white/[0.06] hover:text-text-secondary focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <Users size={13} />
      </button>
      <Dialog open={participantsOpen} onOpenChange={setParticipantsOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Reações</DialogTitle>
          </DialogHeader>
          <div role="tablist" aria-label="Emoji" className="flex flex-wrap gap-1">
            {entries.map(([emoji, userIds]) => (
              <button
                key={emoji}
                type="button"
                role="tab"
                aria-selected={emoji === shownEmoji}
                onClick={() => setActiveEmoji(emoji)}
                className={cn('flex items-center gap-1 rounded-full border px-2 py-0.5 text-label', emoji === shownEmoji ? 'border-primary/50 bg-primary/15' : 'border-white/10 hover:bg-white/[0.06]')}
              >
                <span>{emoji}</span><span className="tabular-nums">{userIds.length}</span>
              </button>
            ))}
          </div>
          <ul role="tabpanel" className="max-h-72 space-y-1 overflow-y-auto">
            {(reactions[shownEmoji] ?? []).map((userId) => {
              const user = allUsers.get(userId);
              const name = userId === myUserId ? 'Você' : user?.displayName ?? REMOVED_USER;
              return (
                <li key={userId} className="flex items-center gap-2 rounded-md px-1 py-1 text-body">
                  <Avatar id={userId} name={name} avatar={user?.avatar ?? ''} avatarColor={user?.avatarColor} size={24} />
                  <span className="truncate">{name}</span>
                </li>
              );
            })}
          </ul>
        </DialogContent>
      </Dialog>
    </div>
  );
}

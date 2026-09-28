import { useEffect, useState } from 'react';
import { Avatar } from '@/shared/Avatar';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/shared/ui/primitives/dialog';
import { cn } from '@/shared/lib/utils';
import { useRoom } from '@/state/RoomContext';
import { withPendingReactions } from './reactionState';
import { reactionParticipantName } from './reactionParticipants';
import type { ReactionEmoji } from '@/shared/types/protocol';

/** The full reaction list — reached from the message menu (desktop
 * right-click, mobile "Ações"), never from the hover tooltip, which stays
 * non-interactive. One instance for the whole app; which message it shows
 * comes from RoomContext's reactionParticipantsTarget, so it works the same
 * from a row in the main chat or in the call panel. */
export function ReactionParticipantsDialog() {
  const { reactionParticipantsTarget: target, closeReactionParticipants, messagesByConversation, allUsers, pendingReactions, state } = useRoom();
  const [activeEmoji, setActiveEmoji] = useState<ReactionEmoji | null>(null);

  const message = target ? messagesByConversation.get(target.conversationId)?.find((m) => m.msgId === target.msgId) : undefined;
  const reactions = message ? withPendingReactions(message.reactions, message.msgId, pendingReactions, state.me.userId) : {};
  const entries = (Object.entries(reactions) as [ReactionEmoji, string[]][]).filter(([, userIds]) => userIds?.length);

  // a fresh target picks its starting tab; reopening the same message resets too
  useEffect(() => {
    if (target) setActiveEmoji(target.emoji ?? null);
  }, [target]);

  // the message left the cache (deleted, or its conversation was evicted) —
  // there's nothing left to show, so don't leave a stale dialog open
  useEffect(() => {
    if (target && !message) closeReactionParticipants();
  }, [target, message, closeReactionParticipants]);

  const shownEmoji = activeEmoji && reactions[activeEmoji]?.length ? activeEmoji : entries[0]?.[0];

  return (
    <Dialog open={!!target} onOpenChange={(next) => { if (!next) closeReactionParticipants(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Reações</DialogTitle>
        </DialogHeader>
        {entries.length === 0 ? (
          <p className="py-4 text-center text-body text-text-muted">Ainda não há reações.</p>
        ) : (
          <>
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
              {(shownEmoji ? reactions[shownEmoji] ?? [] : []).map((userId) => {
                const user = allUsers.get(userId);
                const name = reactionParticipantName(userId, user, state.me.userId);
                return (
                  <li key={userId} className="flex items-center gap-2 rounded-md px-1 py-1 text-body">
                    <Avatar id={userId} name={name} avatar={user?.avatar ?? ''} avatarColor={user?.avatarColor} size={24} />
                    <span className="truncate">{name}</span>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

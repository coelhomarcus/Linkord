import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/ui/primitives/tooltip';
import { cn } from '@/shared/lib/utils';
import { reactionParticipantNames, reactionSummarySentence, summarizeReactionParticipants } from './reactionParticipants';
import type { PublicUser, ReactionEmoji } from '@/shared/types/protocol';

interface MessageReactionsProps {
  reactions: Partial<Record<ReactionEmoji, string[]>>;
  myUserId: string | null;
  allUsers: Map<string, PublicUser>;
  onToggle: (emoji: ReactionEmoji) => void;
}

export function MessageReactions({ reactions, myUserId, allUsers, onToggle }: MessageReactionsProps) {
  const reduced = useReducedMotion();
  const entries = (Object.entries(reactions) as [ReactionEmoji, string[]][]).filter(([, userIds]) => userIds?.length);
  if (!entries.length) return null;

  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      {entries.map(([emoji, userIds]) => {
        const mine = !!myUserId && userIds.includes(myUserId);
        const names = reactionParticipantNames(userIds, allUsers, myUserId);
        return (
          <Tooltip key={emoji}>
            <TooltipTrigger
              // longer than the app's ambient tooltips (0ms): a quick pass
              // over the message shouldn't pop one for every chip it crosses
              delay={400}
              closeDelay={150}
              render={
                <button
                  type="button"
                  aria-pressed={mine}
                  aria-label={`${mine ? 'Remover' : 'Adicionar'} reação ${emoji} (${userIds.length}): ${summarizeReactionParticipants(names)}`}
                  onClick={() => onToggle(emoji)}
                  className={cn(
                    'flex h-6 items-center gap-1 rounded-full border px-1.5 text-label transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                    mine ? 'border-primary/50 bg-primary/15 text-text-primary' : 'border-white/10 bg-white/[0.04] text-text-secondary hover:bg-white/[0.08]'
                  )}
                />
              }
            >
              <span>{emoji}</span>
              {/* fixed box so a count going 9 → 10 doesn't shift the chips */}
              <span className="relative inline-grid min-w-[1ch] overflow-hidden tabular-nums">
                {/* initial={false}: only a change animates, not the first paint */}
                <AnimatePresence initial={false} mode="popLayout">
                  <motion.span
                    key={userIds.length}
                    initial={reduced ? { opacity: 0 } : { opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={reduced ? { opacity: 0 } : { opacity: 0, y: 6 }}
                    transition={{ duration: 0.15, ease: 'easeOut' }}
                  >
                    {userIds.length}
                  </motion.span>
                </AnimatePresence>
              </span>
            </TooltipTrigger>
            <TooltipContent>
              <span aria-hidden>{emoji}</span> {reactionSummarySentence(names)}
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}

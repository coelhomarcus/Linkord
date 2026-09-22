import { Avatar } from '@/shared/Avatar';
import { formatTypingLabel } from '@/shared/lib/formatTypingLabel';
import { useRoom } from '@/state/RoomContext';

const MAX_AVATARS = 3;

function TypingDots() {
  return (
    <span aria-hidden className="flex items-center gap-0.5">
      {[0, 0.2, 0.4].map((delay) => (
        <span
          key={delay}
          className="size-1.5 animate-typing-dot rounded-full bg-current"
          style={{ animationDelay: `${delay}s` }}
        />
      ))}
    </span>
  );
}

/** Discord/Fluxer-style typing row: sits right above the composer (see
 * MessageListBridge), never in the header — a status about the conversation
 * you're about to reply to belongs next to where you type, not competing
 * with the person/group you're talking to for the same line. */
export function TypingIndicator({ conversationId }: { conversationId: string }) {
  const { typingByConversation, allUsers } = useRoom();
  const typingUserIds = [...(typingByConversation.get(conversationId) ?? [])];
  if (typingUserIds.length === 0) return null;

  const typingUsers = typingUserIds
    .map((id) => allUsers.get(id))
    .filter((user): user is NonNullable<typeof user> => !!user);
  const label = formatTypingLabel(typingUsers.map((user) => user.displayName));
  if (!label) return null;

  return (
    <div role="status" aria-live="polite" className="mx-auto flex w-full max-w-5xl items-center gap-2 px-4 pb-1.5 text-label text-text-muted">
      <TypingDots />
      <span className="flex items-center -space-x-1.5">
        {typingUsers.slice(0, MAX_AVATARS).map((user) => (
          <Avatar key={user.id} id={user.id} name={user.displayName} avatar={user.avatar} avatarColor={user.avatarColor} size={16} className="ring-2 ring-[rgb(12_12_14)]" />
        ))}
      </span>
      <span className="truncate">{label}</span>
    </div>
  );
}

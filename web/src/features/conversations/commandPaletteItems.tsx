import type { CommandItem } from '@/components/motion/command-palette';
import { Avatar } from '@/shared/Avatar';
import type { Conversation, Participant, PublicUser } from '@/types/protocol';
import { conversationTitle, directUser } from './conversationUtils';
import { GroupAvatar } from './GroupAvatar';

const ROW_AVATAR_SIZE = 20;

interface CommandPaletteActions {
  onOpenConversation: (conversationId: string) => void;
  onMessageUser: (userId: string) => void;
  onCall: (conversationId: string) => void;
}

/** The same visual identity shown everywhere else for this conversation
 * (ConversationSidebar's rows, ConversationPanel's header) — a direct
 * conversation shows the OTHER member's own avatar, a group shows its own
 * (or its initials, via GroupAvatar). Sized down for a command-row instead
 * of a sidebar row. */
function conversationAvatar(conversation: Conversation, title: string, meUserId: string | null, allUsers: Map<string, PublicUser>) {
  if (conversation.type === 'direct') {
    const other = directUser(conversation, meUserId, allUsers);
    if (other) return <Avatar id={other.id} name={other.displayName} avatar={other.avatar} avatarColor={other.avatarColor} size={ROW_AVATAR_SIZE} />;
  }
  return <GroupAvatar title={title} avatar={conversation.avatar} size={ROW_AVATAR_SIZE} />;
}

function userAvatar(user: PublicUser) {
  return <Avatar id={user.id} name={user.displayName} avatar={user.avatar} avatarColor={user.avatarColor} size={ROW_AVATAR_SIZE} />;
}

/** Pure builder for the ⌘K command palette's item list — kept separate from
 * where it's assembled (App.tsx#Shell) so the grouping/dedup logic can be
 * tested without mocking the whole RoomContext. `actions` is the only
 * side-effecting part, injected by the caller. */
export function buildCommandItems(
  conversations: Conversation[],
  allUsers: Map<string, PublicUser>,
  meUserId: string | null,
  participants: Map<string, Participant>,
  activeCallConversationId: string | null,
  actions: CommandPaletteActions
): CommandItem[] {
  const items: CommandItem[] = [];

  const directUserIds = new Set<string>();
  for (const conversation of conversations) {
    const other = directUser(conversation, meUserId, allUsers);
    if (other) directUserIds.add(other.id);
  }

  // Which conversations currently have someone actually in a call, other
  // than the one I'm already in myself — that one gets its own "iniciar"
  // framing below instead, since "entrar" in a call I'm already in isn't a
  // meaningful new action.
  const conversationsWithActiveCall = new Set<string>();
  for (const participant of participants.values()) {
    if (participant.callConversationId && participant.callConversationId !== activeCallConversationId) {
      conversationsWithActiveCall.add(participant.callConversationId);
    }
  }

  for (const conversation of conversations) {
    const title = conversationTitle(conversation, meUserId, allUsers);
    items.push({
      id: `conversation:${conversation.id}`,
      label: title,
      group: 'Conversas',
      avatar: conversationAvatar(conversation, title, meUserId, allUsers),
      onSelect: () => actions.onOpenConversation(conversation.id),
    });
  }

  for (const user of allUsers.values()) {
    if (user.id === meUserId || directUserIds.has(user.id)) continue;
    items.push({
      id: `person:${user.id}`,
      label: `Conversar com ${user.displayName}`,
      group: 'Pessoas',
      keywords: [user.username],
      avatar: userAvatar(user),
      onSelect: () => actions.onMessageUser(user.id),
    });
  }

  for (const conversation of conversations) {
    if (!conversationsWithActiveCall.has(conversation.id)) continue;
    const title = conversationTitle(conversation, meUserId, allUsers);
    items.push({
      id: `join-call:${conversation.id}`,
      label: `Entrar na chamada em ${title}`,
      group: 'Chamadas em andamento',
      avatar: conversationAvatar(conversation, title, meUserId, allUsers),
      onSelect: () => actions.onCall(conversation.id),
    });
  }

  for (const conversation of conversations) {
    if (conversationsWithActiveCall.has(conversation.id) || conversation.id === activeCallConversationId) continue;
    const title = conversationTitle(conversation, meUserId, allUsers);
    items.push({
      id: `start-call:${conversation.id}`,
      label: `Iniciar chamada em ${title}`,
      group: 'Iniciar chamada',
      avatar: conversationAvatar(conversation, title, meUserId, allUsers),
      onSelect: () => actions.onCall(conversation.id),
    });
  }

  return items;
}

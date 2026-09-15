import { MessageCircle, Phone, PhoneCall, UsersRound } from 'lucide-react';
import type { CommandItem } from '@/components/motion/command-palette';
import type { Conversation, Participant, PublicUser } from '@/types/protocol';
import { conversationTitle, directUser } from './conversationUtils';

interface CommandPaletteActions {
  onOpenConversation: (conversationId: string) => void;
  onMessageUser: (userId: string) => void;
  onCall: (conversationId: string) => void;
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
      icon: conversation.type === 'group' ? UsersRound : MessageCircle,
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
      icon: UsersRound,
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
      icon: PhoneCall,
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
      icon: Phone,
      onSelect: () => actions.onCall(conversation.id),
    });
  }

  return items;
}

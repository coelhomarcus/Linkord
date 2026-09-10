import type { Conversation, Participant, PublicUser } from '@/types/protocol';

export function conversationTitle(conversation: Conversation | null | undefined, meUserId: string | null, users: Map<string, PublicUser>): string {
  if (!conversation) return 'Conversa';
  if (conversation.type === 'group') return conversation.title || 'Grupo';
  const otherId = conversation.memberIds.find((id) => id !== meUserId) ?? conversation.memberIds[0];
  const other = otherId ? users.get(otherId) : undefined;
  return other?.displayName || other?.username || 'Conversa direta';
}

export function conversationInitials(title: string): string {
  const words = title.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 'L';
  return words.slice(0, 2).map((word) => word[0]?.toUpperCase()).join('');
}

export function directUser(conversation: Conversation | null | undefined, meUserId: string | null, users: Map<string, PublicUser>): PublicUser | null {
  if (!conversation || conversation.type !== 'direct') return null;
  const otherId = conversation.memberIds.find((id) => id !== meUserId);
  return otherId ? users.get(otherId) ?? null : null;
}

export function groupMembers(conversation: Conversation | null | undefined, users: Map<string, PublicUser>): PublicUser[] {
  if (!conversation) return [];
  return conversation.memberIds
    .map((id) => users.get(id))
    .filter((user): user is PublicUser => !!user)
    .sort((a, b) => a.displayName.localeCompare(b.displayName) || a.username.localeCompare(b.username));
}

export function callParticipantIds(meParticipantId: string | null, participants: Map<string, Participant>, conversationId: string | null): string[] {
  if (!conversationId) return [];
  const ids: string[] = [];
  if (meParticipantId) ids.push(meParticipantId);
  for (const participant of participants.values()) {
    if (participant.callConversationId === conversationId) ids.push(participant.id);
  }
  return [...new Set(ids)];
}

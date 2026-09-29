import type { PublicUser, ReactionEmoji } from '@/shared/types/protocol';

export interface ReactionParticipantsTarget {
  conversationId: string;
  msgId: number;
  /** Preselects a tab when the dialog was opened from a specific chip. */
  emoji?: ReactionEmoji;
}

// missing data isn't proof the account was removed — the user just hasn't
// loaded into allUsers yet
export const REACTION_PARTICIPANT_FALLBACK = 'Participante indisponível';

export function reactionParticipantName(userId: string, user: PublicUser | undefined, myUserId: string | null): string {
  if (userId === myUserId) return 'Você';
  return user?.displayName ?? REACTION_PARTICIPANT_FALLBACK;
}

export function reactionParticipantNames(userIds: string[], allUsers: Map<string, PublicUser>, myUserId: string | null): string[] {
  return userIds.map((id) => reactionParticipantName(id, allUsers.get(id), myUserId));
}

/** "Ana, Bia e mais 3" — compact form for the chip's accessible name. */
export function summarizeReactionParticipants(names: string[]): string {
  if (names.length <= 3) return names.join(', ');
  return `${names.slice(0, 3).join(', ')} e mais ${names.length - 3}`;
}

function joinReactionNames(names: string[]): string {
  if (names.length === 1) return names[0]!;
  if (names.length === 2) return `${names[0]} e ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`;
}

/** "Ana, Bia e Caio reagiram" / "Você reagiu" — the hover tooltip's sentence. */
export function reactionSummarySentence(names: string[]): string {
  if (!names.length) return '';
  if (names.length === 1) return `${names[0]} reagiu`;
  if (names.length <= 3) return `${joinReactionNames(names)} reagiram`;
  const rest = names.length - 3;
  return `${names.slice(0, 3).join(', ')} e mais ${rest} ${rest === 1 ? 'pessoa' : 'pessoas'} reagiram`;
}

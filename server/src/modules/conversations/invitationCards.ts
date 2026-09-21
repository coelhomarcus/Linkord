import { inArray, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { conversations, groupInvitations } from '../../db/schema.js';

// Leaf module (db/schema only): messages.ts needs the card payload to
// serialize history, and invitationsRepository.ts needs messages' consumers —
// keeping the shared pieces here stops the two from importing each other.

export type InvitationStatus = 'pending' | 'accepted' | 'declined' | 'revoked' | 'expired';

/** `pending` past its deadline reads as `expired` everywhere — on read and on
 * accept — without waiting for the sweeper to persist it (the index can't
 * depend on now(), so validity is checked in code: docs/plano-rede-social.md §6.2). */
export function effectiveStatus(status: string, expiresAt: Date, now = new Date()): InvitationStatus {
  if (status === 'pending' && expiresAt.getTime() <= now.getTime()) return 'expired';
  return status as InvitationStatus;
}

/** Everything the card in a DM may show BEFORE the person joins — group name
 * and photo, member COUNT, who invited, validity. Never the member list,
 * messages or call activity (§5.6). */
export interface InvitationCard {
  id: string;
  status: InvitationStatus;
  groupId: string;
  groupTitle: string;
  groupAvatar: string;
  memberCount: number;
  inviterId: string;
  inviteeId: string;
  expiresAt: number;
  version: number;
}

/** One batched read for any number of invitations — history pages carry many
 * cards and must not cost a query each. A missing id (invitation deleted with
 * its group) is simply absent from the map: the caller renders the tombstone. */
export async function loadInvitationCards(ids: string[]): Promise<Map<string, InvitationCard>> {
  const cards = new Map<string, InvitationCard>();
  if (!ids.length) return cards;
  const rows = await db
    .select({
      id: groupInvitations.id, status: groupInvitations.status, expiresAt: groupInvitations.expiresAt,
      conversationId: groupInvitations.conversationId, inviterId: groupInvitations.inviterId,
      inviteeId: groupInvitations.inviteeId, version: groupInvitations.version,
      groupTitle: conversations.title, groupAvatar: conversations.avatar,
      memberCount: sql<number>`(select count(*)::int from conversation_members m where m.conversation_id = ${groupInvitations.conversationId})`,
    })
    .from(groupInvitations)
    .innerJoin(conversations, sql`${conversations.id} = ${groupInvitations.conversationId}`)
    .where(inArray(groupInvitations.id, ids));
  const now = new Date();
  for (const r of rows) {
    cards.set(r.id, {
      id: r.id, status: effectiveStatus(r.status, r.expiresAt, now), groupId: r.conversationId,
      groupTitle: r.groupTitle, groupAvatar: r.groupAvatar, memberCount: r.memberCount,
      inviterId: r.inviterId, inviteeId: r.inviteeId, expiresAt: r.expiresAt.getTime(), version: r.version,
    });
  }
  return cards;
}

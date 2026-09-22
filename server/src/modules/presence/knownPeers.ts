import { participants, send, publicParticipant, listOnlineUserIds } from './participants.js';
import { listFriendIds } from '../friendships/friendshipsRepository.js';
import { listBlockedEitherWayIds } from '../blocks/blocksRepository.js';
import { listConversationMemberIds } from '../conversations/conversationsRepository.js';
import { listUsersByIds } from '../users/users.js';
import type { Participant } from '../../types.js';
import { logger } from '../../lib/logger.js';

const log = logger.child({ component: 'presence' });

// "Known peers" = friends ∪ members of every conversation an account is in.
// Presence is scoped to this set (participants.ts#broadcastToKnownPeers), but
// the set is computed per CONNECTION and would otherwise go stale the moment
// a friendship or conversation membership changes. This module is the single
// place that recomputes it and tells the affected clients — it lives here,
// not in realtime/socket.ts, because HTTP handlers (friendships/blocks) need
// it too and must not import the socket composition root.

export async function computePeerVisibility(userId: string): Promise<{ known: Set<string>; friends: Set<string>; blocked: Set<string> }> {
  const [friendIds, memberIds, blockedIds] = await Promise.all([
    listFriendIds(userId),
    listConversationMemberIds(userId),
    listBlockedEitherWayIds(userId),
  ]);
  return { known: new Set([...friendIds, ...memberIds]), friends: new Set(friendIds), blocked: new Set(blockedIds) };
}

/** Recomputes both sets on a connection in place. */
export async function applyPeerVisibility(p: Participant): Promise<void> {
  const { known, friends, blocked } = await computePeerVisibility(p.userId);
  p.knownPeerIds = known;
  p.friendPeerIds = friends;
  p.blockedPeerIds = blocked;
}

/** What one connection is allowed to know about everyone else — the same
 * shape the `welcome` carries. The account itself is included in
 * `knownUsers`: the client resolves its OWN authorship/membership rows from
 * the same cache as everyone else's. */
export async function buildPresenceSnapshot(p: Participant) {
  return {
    knownUsers: await listUsersByIds([p.userId, ...p.knownPeerIds]),
    // knownUsers keeps blocked peers (shared history still needs their
    // names); everything LIVE about them is withheld
    participants: [...participants.values()]
      .filter((o) => o.id !== p.id && p.knownPeerIds.has(o.userId) && !p.blockedPeerIds.has(o.userId))
      .map(publicParticipant),
    onlineUserIds: listOnlineUserIds().filter((id) => p.knownPeerIds.has(id) && !p.blockedPeerIds.has(id)),
    // the friend SUBSET of knownUsers — lets the client offer "message this
    // person" only for an actual friend, not every conversation co-member
    // knownUsers also carries (see Participant#friendPeerIds).
    friendIds: [...p.friendPeerIds],
  };
}

function connectionsOf(userId: string): Participant[] {
  return [...participants.values()].filter((p) => p.userId === userId && p.socket);
}

/** Recomputes `knownPeerIds` for every live connection of each account and
 * pushes a fresh `presence-sync`. Accounts with no live connection are
 * skipped — their next `join` computes it from scratch. Never throws: it runs
 * AFTER a mutation already committed, and a failed push must not turn a
 * successful request into an error. */
export async function refreshKnownPeers(userIds: string[]): Promise<void> {
  for (const userId of new Set(userIds)) {
    try {
      const connections = connectionsOf(userId);
      if (!connections.length) continue;
      const { known, friends, blocked } = await computePeerVisibility(userId);
      for (const p of connections) {
        p.knownPeerIds = known;
        p.friendPeerIds = friends;
        p.blockedPeerIds = blocked;
        send(p.socket, { t: 'presence-sync', ...(await buildPresenceSnapshot(p)) });
      }
    } catch (err) {
      log.error('failed to refresh known peers', err, { userId });
    }
  }
}

/** A payload-free signal: "your friends/requests/blocks changed, refetch".
 * The data itself only ever travels over the authorized HTTP endpoints. */
export function notifySocialChanged(userIds: string[]): void {
  for (const userId of new Set(userIds)) {
    for (const p of connectionsOf(userId)) send(p.socket, { t: 'social-changed' });
  }
}

/** The pair-level convenience every friendship/block mutation calls. */
export async function onSocialChange(a: string, b: string): Promise<void> {
  await refreshKnownPeers([a, b]);
  notifySocialChanged([a, b]);
}

import type { Socket } from 'socket.io';

export type Role = 'user' | 'admin';

/** Resolved session (see modules/auth/session.ts#resolveSession) —
 * attached as socket.user at handshake, used by every authenticated HTTP
 * route. */
export interface SessionUser {
  tokenHash: string;
  userId: string;
  username: string;
  email: string | null;
  // free-form, non-unique — always resolved to a non-empty value here (see
  // auth/session.ts), falling back to `username` when the account never set one.
  displayName: string;
  avatar: string;
  avatarPoster: string;
  avatarColor: string;
  banner: string;
  bannerPoster: string;
  bio: string;
  profileLinks: string[];
  role: Role;
}

/** The single room's participant (see realtime/participants.ts). `id` is
 * per-CONNECTION (not per-account) — see the note in participants.ts.
 * `socket` is null during the reconnect grace window. */
export interface Participant {
  id: string;
  token: string;
  userId: string;
  socket: AppSocket | null;
  name: string;
  // editable, non-unique — what's shown everywhere in the UI instead of
  // `name`. Always non-empty (falls back to `name` — the username — server-side).
  displayName: string;
  avatar: string;
  avatarPoster: string;
  avatarColor: string;
  banner: string;
  bannerPoster: string;
  bio: string;
  profileLinks: string[];
  role: Role;
  deafened: boolean;
  // Which group conversation call they're in now, or null — set explicitly by
  // call join/leave (see realtime/socket.ts), never just from having the
  // socket connected.
  callConversationId: string | null;
  // self-reported by the client (see realtime/participants.ts handlers for
  // 'mic-state'/'camera'/'screen-share'/'speaking') — the server never
  // verifies these against LiveKit itself, same trust model as `deafened`.
  // Reset to their defaults on every call join/leave (setCallConversationId),
  // so a stale value never survives a call switch.
  micActivated: boolean;
  micMuted: boolean;
  cameraOn: boolean;
  sharing: boolean;
  speaking: boolean;
  graceTimer: ReturnType<typeof setTimeout> | null;
  // Friends ∪ members of every conversation this account is in — computed
  // ONCE per connection (handleJoin, realtime/socket.ts), not on every
  // presence event (mic/speaking toggles fire too often for a DB round trip
  // each time). Used to scope presence broadcasts (broadcastToKnownPeers)
  // so an unrelated account never sees this connection's mic/camera/
  // online state. Deliberately stale until the next reconnect — a brand
  // new friend's live presence only starts showing up after either side
  // reconnects, not immediately.
  knownPeerIds: Set<string>;
  // The friend subset of knownPeerIds above — a conversation co-member who
  // isn't a friend is IN knownPeerIds (their profile/presence is needed to
  // render the shared conversation) but must not be offered as a DM target
  // (docs/plano-rede-social.md §3: DMs are friends-only) or listed as a
  // friend anywhere else. Computed alongside knownPeerIds, same staleness.
  friendPeerIds: Set<string>;
  // Accounts with a block against this one in EITHER direction. Still in
  // knownPeerIds when they share a conversation (their profile is needed to
  // render the shared history), but presence — online, call/mic/camera state,
  // reactions — never flows between the two (docs/plano-rede-social.md §7.3).
  blockedPeerIds: Set<string>;
}

/** Public shape of a Participant — what goes to the client (never `token`). */
export interface PublicParticipant {
  id: string;
  userId: string;
  name: string;
  displayName: string;
  avatar: string;
  avatarPoster: string;
  avatarColor: string;
  banner: string;
  bannerPoster: string;
  bio: string;
  profileLinks: string[];
  role: Role;
  deafened: boolean;
  callConversationId: string | null;
  micActivated: boolean;
  micMuted: boolean;
  cameraOn: boolean;
  sharing: boolean;
  speaking: boolean;
}

/** The socket.io `Socket` with fields realtime/socket.ts attaches
 * dynamically on connection: `participantId` (set by join()), `ip`
 * (computed once on connect), and `user` (the session resolved in io.use()
 * before 'connection' fires — no socket exists without it). */
export type AppSocket = Socket & {
  participantId: string | null;
  ip: string;
  user: SessionUser;
};

/** Socket.IO message handler signature — each feature exports a
 * `handlers: HandlerTable` (see realtime/socket.ts, combined via
 * Object.assign). `T` is left loose (`any` in the combined table) on
 * purpose: each concrete handler uses its real payload type, and `any` on
 * the target parameter lets TypeScript accept that without bypassing the
 * type check INSIDE each handler. */
export type SocketHandler<T = unknown> = (socket: AppSocket, msg: T) => unknown | Promise<unknown>;
export type HandlerTable = Record<string, SocketHandler<any>>;

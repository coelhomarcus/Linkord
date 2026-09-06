import type { Socket } from 'socket.io';

export type Role = 'user' | 'admin';

/** Resolved session (see modules/auth/session.ts#resolveSession) —
 * attached as socket.user at handshake, used by every authenticated HTTP
 * route. */
export interface SessionUser {
  tokenHash: string;
  userId: string;
  username: string;
  avatar: string;
  role: Role;
  /** Absolute session expiry copied from the DB so a connected socket can
   * close itself at the same boundary without trusting the cookie again. */
  expiresAtMs: number;
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
  avatar: string;
  role: Role;
  deafened: boolean;
  // which voice channel they're in now, or null — set explicitly by
  // 'voice-join'/'voice-leave' (see realtime/socket.ts), never just from
  // having the socket connected. Needed server-side (not just client-local
  // like `deafened`) because the sidebar shows who's in EACH voice channel,
  // not just the one I'm connected to (LiveKit itself only gives me
  // participants in MY room).
  voiceChannelId: string | null;
  // self-reported by the client (see realtime/participants.ts handlers for
  // 'mic-state'/'camera'/'screen-share'/'speaking') — the server never
  // verifies these against LiveKit itself, same trust model as `deafened`.
  // Reset to their defaults on every voice-join/leave (setVoiceChannelId),
  // so a stale value never survives a channel switch.
  micActivated: boolean;
  micMuted: boolean;
  cameraOn: boolean;
  sharing: boolean;
  speaking: boolean;
  graceTimer: ReturnType<typeof setTimeout> | null;
}

/** Public shape of a Participant — what goes to the client (never `token`). */
export interface PublicParticipant {
  id: string;
  userId: string;
  name: string;
  avatar: string;
  role: Role;
  deafened: boolean;
  voiceChannelId: string | null;
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
  sessionExpiryTimer?: ReturnType<typeof setTimeout>;
};

/** Socket.IO message handler signature — each feature exports a
 * `handlers: HandlerTable` (see realtime/socket.ts, combined via
 * Object.assign). `T` is left loose (`any` in the combined table) on
 * purpose: each concrete handler uses its real payload type, and `any` on
 * the target parameter lets TypeScript accept that without bypassing the
 * type check INSIDE each handler. */
export type SocketHandler<T = unknown> = (socket: AppSocket, msg: T) => unknown | Promise<unknown>;
export type HandlerTable = Record<string, SocketHandler<any>>;

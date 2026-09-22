// The server's error codes this client branches on. The full registry lives in
// server/src/http/errors.ts; server/tests/http/errors.test.ts fails if a code
// listed here isn't in it, so a rename on the server can't leave the UI matching
// a code that no longer exists.
export const ERROR_CODES = {
  // socket `error` messages
  full: 'full',
  client_outdated: 'client_outdated',
  too_many_connections: 'too_many_connections',
  'livekit-unavailable': 'livekit-unavailable',
  'message-not-found': 'message-not-found',
  // shared by HTTP and socket
  forbidden: 'forbidden',
  conflict: 'conflict',
  not_found: 'not_found',
  quota_exceeded: 'quota_exceeded',
  rate_limited: 'rate_limited',
  // HTTP
  group_full: 'group_full',
  user_unavailable: 'user_unavailable',
  cooldown: 'cooldown',
  username_taken: 'username_taken',
  invalid_username: 'invalid_username',
  email_taken: 'email_taken',
  invalid_email: 'invalid_email',
  weak_password: 'weak_password',
  password_mismatch: 'password_mismatch',
  invalid_code: 'invalid_code',
  reason_required: 'reason_required',
  self_action: 'self_action',
  last_admin: 'last_admin',
  confirmation_mismatch: 'confirmation_mismatch',
  already_admin: 'already_admin',
  not_admin: 'not_admin',
  target_inactive: 'target_inactive',
} as const;

export type KnownErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

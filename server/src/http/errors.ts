// Every stable error code the server can put on the wire, HTTP or socket
// (docs/contratos.md lists what each one means). `sendError` and the socket
// `error` message only accept a code from here, so a typo doesn't compile, and
// tests check that every HTTP status used with a code is one of its `statuses`.
//
// `channel`: where the code is emitted. `statuses` is empty for socket-only
// codes. A code with two statuses is used for two distinct situations
// (documented next to it).

type Channel = 'http' | 'socket' | 'both';
interface ErrorSpec { readonly statuses: readonly number[]; readonly channel: Channel }

export const ERROR_REGISTRY = {
  // generic
  unauthenticated: { statuses: [401], channel: 'http' },
  forbidden: { statuses: [403], channel: 'both' },
  not_found: { statuses: [404], channel: 'both' },
  conflict: { statuses: [409], channel: 'both' },
  rate_limited: { statuses: [429], channel: 'both' },
  internal_error: { statuses: [500], channel: 'http' },
  invalid_json: { statuses: [400], channel: 'http' },
  invalid_request: { statuses: [400], channel: 'http' },
  invalid_body: { statuses: [400], channel: 'http' },
  invalid_id: { statuses: [400], channel: 'http' },
  invalid_cursor: { statuses: [400], channel: 'http' },
  invalid_direction: { statuses: [400], channel: 'http' },
  invalid_action: { statuses: [400], channel: 'http' },
  invalid_target: { statuses: [400], channel: 'http' },
  invalid_index: { statuses: [400], channel: 'http' },
  invalid_log: { statuses: [400], channel: 'http' },
  invalid_title: { statuses: [400], channel: 'http' },
  invalid_size: { statuses: [400], channel: 'http' },
  invalid_type: { statuses: [400], channel: 'http' },
  invalid_url: { statuses: [400], channel: 'http' },
  missing_url: { statuses: [400], channel: 'http' },
  reason_required: { statuses: [400], channel: 'http' },
  // never reveals whether the other side is blocked, missing or just unreachable (§5.4)
  user_unavailable: { statuses: [404], channel: 'http' },
  user_not_found: { statuses: [404], channel: 'http' },
  relationship_required: { statuses: [403], channel: 'both' },
  cooldown: { statuses: [409], channel: 'http' },
  // 400: the account's storage quota (upload init); 409: a count quota that needs
  // another action first (friends, pending requests, groups)
  quota_exceeded: { statuses: [400, 409], channel: 'both' },
  storage_full: { statuses: [400], channel: 'http' },

  // auth and accounts
  invalid_credentials: { statuses: [401], channel: 'http' },
  account_unavailable: { statuses: [403], channel: 'http' },
  registration_closed: { statuses: [403], channel: 'http' },
  registration_paused: { statuses: [429], channel: 'http' },
  // 403: the registration invite code; 400: a malformed or wrong e-mail confirmation code
  invalid_code: { statuses: [400, 403], channel: 'http' },
  code_expired: { statuses: [400], channel: 'http' },
  too_many_attempts: { statuses: [400], channel: 'http' },
  invalid_username: { statuses: [400], channel: 'http' },
  username_taken: { statuses: [409], channel: 'http' },
  invalid_email: { statuses: [400], channel: 'http' },
  email_taken: { statuses: [409], channel: 'http' },
  email_already_set: { statuses: [409], channel: 'http' },
  email_unavailable: { statuses: [503], channel: 'http' },
  same_email: { statuses: [400], channel: 'http' },
  weak_password: { statuses: [400], channel: 'http' },
  password_mismatch: { statuses: [400], channel: 'http' },
  forbidden_origin: { statuses: [403], channel: 'both' },

  // groups and invitations
  group_full: { statuses: [409], channel: 'http' },
  too_many_invitees: { statuses: [400], channel: 'http' },

  // conversations, messages, attachments
  conversation_not_found: { statuses: [404], channel: 'http' },
  conversation_mismatch: { statuses: [400], channel: 'http' },
  not_your_message: { statuses: [403], channel: 'http' },
  target_message_not_found: { statuses: [404], channel: 'http' },
  target_message_too_old: { statuses: [400], channel: 'http' },
  too_many_attachments: { statuses: [400], channel: 'http' },
  upload_not_found: { statuses: [404], channel: 'http' },
  already_completing: { statuses: [409], channel: 'http' },
  incomplete_upload: { statuses: [400], channel: 'http' },
  chunk_size_mismatch: { statuses: [400], channel: 'http' },
  size_mismatch: { statuses: [400], channel: 'http' },
  empty_file: { statuses: [400], channel: 'http' },
  invalid_crop: { statuses: [400], channel: 'http' },
  crop_failed: { statuses: [400], channel: 'http' },
  fetch_failed: { statuses: [400], channel: 'http' },
  file_too_large: { statuses: [400], channel: 'http' },
  too_many_redirects: { statuses: [400], channel: 'http' },
  invalid_report: { statuses: [400], channel: 'http' },

  // admin actions (docs/plano-rede-social.md §9)
  self_action: { statuses: [409], channel: 'http' },
  last_admin: { statuses: [409], channel: 'http' },
  already_suspended: { statuses: [409], channel: 'http' },
  not_suspended: { statuses: [409], channel: 'http' },
  not_member: { statuses: [409], channel: 'http' },
  confirmation_mismatch: { statuses: [400], channel: 'http' },
  already_admin: { statuses: [409], channel: 'http' },
  not_admin: { statuses: [409], channel: 'http' },
  target_inactive: { statuses: [409], channel: 'http' },
  already_closed: { statuses: [409], channel: 'http' },
  not_open: { statuses: [409], channel: 'http' },
  action_failed: { statuses: [409], channel: 'http' },

  // socket only
  client_outdated: { statuses: [], channel: 'socket' },
  full: { statuses: [], channel: 'socket' },
  too_many_connections: { statuses: [], channel: 'socket' },
  unauthorized: { statuses: [], channel: 'socket' },
  auth_error: { statuses: [], channel: 'socket' },
  'call-not-allowed': { statuses: [], channel: 'socket' },
  'livekit-unavailable': { statuses: [], channel: 'socket' },
  'message-not-found': { statuses: [], channel: 'socket' },
} as const satisfies Record<string, ErrorSpec>;

export type ErrorCode = keyof typeof ERROR_REGISTRY;

// Named handles for the codes the socket handlers use by name.
export const ERROR_CODES = {
  forbidden: 'forbidden',
  notFound: 'not_found',
  conflict: 'conflict',
  // not friends (or blocked) with the other side of a direct conversation —
  // canSendDirectMessage's write-path gates.
  relationshipRequired: 'relationship_required',
} as const satisfies Record<string, ErrorCode>;

/** The JSON body of an error response. Extra fields (`retryAfter`, `quota`)
 * ride along without a code of their own. */
export function errorBody(code: ErrorCode, message: string, extra: Record<string, unknown> = {}): { error: { code: ErrorCode; message: string } & Record<string, unknown> } {
  return { error: { code, message, ...extra } };
}

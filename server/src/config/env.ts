import path from 'node:path';

const PORT = Number(process.env.PORT || 3000);
const HOST_BIND = process.env.HOST_BIND || '0.0.0.0';
const MAX_PARTICIPANTS = Number(process.env.MAX_PARTICIPANTS || 50);
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
// Socket.IO TRANSPORT cap (kills the connection if exceeded), not app
// validation — video/uploads don't go through the socket, so 64KB is
// plenty for signaling.
const MAX_MSG_BYTES = Number(process.env.MAX_MSG_BYTES || 64 * 1024);
// how long a dropped connection's identity is held for reconnection before
// counting as "left".
const RECONNECT_GRACE_MS = Number(process.env.RECONNECT_GRACE_MS || 30000);
const MAX_AVATAR_LEN = 500;
const MAX_BANNER_LEN = 500;
const MAX_PROFILE_BIO_LEN = 300;
const MAX_PROFILE_LINKS = 8;
const MAX_PROFILE_LINK_LEN = 300;
const MAX_CHAT_LEN = 2000;
const CHAT_HISTORY_LIMIT = 50; // messages kept to give context to whoever joins later
const SEARCH_RESULT_LIMIT = 30; // server-fixed, not client-controlled — same posture as CHAT_HISTORY_LIMIT
const MAX_SEARCH_QUERY_LEN = 200;
const MAX_ATTACHMENTS_PER_MESSAGE = 4;
// how long after creating a message its author can still attach more files
// to it (2nd-4th attachment) — without this, `targetMsgId` would let someone
// inject media into an arbitrarily old message of theirs at any time.
const ATTACH_TO_MESSAGE_WINDOW_MS = 5 * 60 * 1000;
// after a friend request is declined/cancelled/removed, how long the SAME
// requester has to wait before requesting that account again — an initial
// guess (docs/plano-rede-social.md §10.2.8: "valores iniciais precisam de
// teste"), not a validated product decision. Doesn't gate the other side
// requesting back right away, only a repeat from whoever just got turned down.
const FRIEND_REQUEST_COOLDOWN_MS = 24 * 60 * 60 * 1000;
// Group invitations (docs/plano-rede-social.md §3/§6.2). First guesses like the
// cooldown above, not validated product numbers.
const GROUP_INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// after a DECLINE only — a revoked or expired invite can be re-sent right away
const GROUP_INVITATION_RESEND_COOLDOWN_MS = 24 * 60 * 60 * 1000;
// gates NEW acceptances only: an existing group already above this keeps every member
const MAX_GROUP_MEMBERS = Number(process.env.MAX_GROUP_MEMBERS || 50);
const MAX_INVITEES_PER_REQUEST = 20;

// anchored to the repo root (not cwd) — inside Docker this is /app/uploads
// (matches the external bind mount); in `npm run dev` it's <repo>/uploads.
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(import.meta.dirname, '..', '..', '..', 'uploads');
const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_STORAGE_BYTES = 30 * 1024 * 1024 * 1024;
// comfortably under common proxy limits (e.g. Cloudflare Free/Pro caps
// request bodies around 100MB)
const UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024;
// abandoned upload session (UPLOAD_DIR/tmp/<uploadId>) expiry — swept at
// boot and hourly.
const UPLOAD_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
// avatar — same folder/route as attachments, smaller cap, one per account,
// excluded from the attachment quota.
const MAX_AVATAR_BYTES = 12 * 1024 * 1024;

// required now that identity lives in the DB — the process won't boot
// without it (see bootstrap in index.ts).
const DATABASE_URL = process.env.DATABASE_URL || '';
// DB URL is remote; without sslmode, credentials/session data cross the
// network in plaintext. '1' enables TLS.
const DATABASE_SSL = process.env.DATABASE_SSL === '1';
// Optional pinned CA (PEM) for a Postgres that presents a self-signed or
// privately-issued cert Node's default trust store won't validate — the
// certificate verification stays ON (see db/client.ts), it's just checked
// against this cert instead of the public CA bundle. Supports either a
// literal multi-line value or a single-line one with escaped "\n"s (the
// common way to fit a PEM into a one-line .env/Dokploy variable).
const DATABASE_SSL_CA = (process.env.DATABASE_SSL_CA || '').replace(/\\n/g, '\n').trim();
// runs pending migrations before accepting connections — on by default
// since neither deploy path (Docker CMD, systemd ExecStart) goes through
// an npm script.
const MIGRATE_ON_BOOT = process.env.MIGRATE_ON_BOOT !== '0';

const SESSION_COOKIE = process.env.SESSION_COOKIE || 'ss_session';
const SESSION_TTL_DAYS = Number(process.env.SESSION_TTL_DAYS || 30);
// closed by default: fail-closed so a deploy that forgot to set this
// doesn't become open registration.
const REGISTRATION_CODE = process.env.REGISTRATION_CODE || '';
// (ADMIN_USERNAME is gone: registering never grants admin anymore. Admins are
// provisioned explicitly — `npm run admin:grant -- <username>` or the /admin area.)
// 'auto' reads X-Forwarded-Proto (set by Caddy/nginx); '1'/'0' force it —
// otherwise the Secure cookie attribute breaks local http:// dev.
const COOKIE_SECURE = process.env.COOKIE_SECURE || 'auto';
// HTTP request body (login/register JSON) — unrelated to MAX_MSG_BYTES
// (Socket.IO's own transport cap).
const MAX_BODY_BYTES = 8 * 1024;
const MIN_USERNAME_LEN = 3;
const MAX_USERNAME_LEN = 20;
const MAX_DISPLAY_NAME_LEN = 32;
const MIN_PASSWORD_LEN = 8;
const MAX_PASSWORD_LEN = 200; // hygiene cap — hashing a 1MB password would be a DoS vector
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL || '';
const APP_URL = (process.env.APP_URL || '').trim().replace(/\/+$/, '');
const AUTH_CODE_TTL_MS = 30 * 60 * 1000;
const AUTH_CODE_MAX_ATTEMPTS = 5;

// LiveKit Cloud — camera/screen become real WebRTC (managed SFU).
const LIVEKIT_URL = process.env.LIVEKIT_URL || '';
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || '';
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || '';
// prefix for each group call's LiveKit room name (see
// realtime/livekit.ts) — one room per group, not a single shared one.
const LIVEKIT_ROOM_NAME = process.env.LIVEKIT_ROOM_NAME || 'linkord-room';
// A token only gates ENTERING a room; LiveKit can't recall one already issued,
// so a short life bounds how long a removed member could still reconnect with
// an old token (removal also evicts live connections, see evictFromCall).
const LIVEKIT_TOKEN_TTL_SECONDS = Number(process.env.LIVEKIT_TOKEN_TTL_SECONDS || 300);

// optional — notifies a Discord channel when someone joins the call or
// starts sharing (see modules/discordWebhook.ts). Empty disables it silently.
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || '';

// optional, dev convenience only: when DATABASE_URL points at the same DB a
// deployed instance uses, `attachments` rows exist locally but the actual
// FILES only live on that instance's disk (UPLOAD_DIR is always local, never
// synced). Set this to that instance's base URL and serveUpload will fetch
// (and cache) a missing file from there on first request instead of 404ing.
// Never needed in the deployment this var would point AT. Trailing slash
// stripped so `${UPLOADS_REMOTE_URL}/uploads/<id>` doesn't double up.
const UPLOADS_REMOTE_URL = (process.env.UPLOADS_REMOTE_URL || '').trim().replace(/\/+$/, '');

// ---- abuse limits (etapa 12). Initial values are starting guesses, not
// measured capacity — tune them against real use (docs/plano-rede-social.md §10.2.8).
const REGISTRATIONS_PER_IP_PER_HOUR = Number(process.env.REGISTRATIONS_PER_IP_PER_HOUR || 5);
const MAX_NEW_ACCOUNTS_PER_HOUR = Number(process.env.MAX_NEW_ACCOUNTS_PER_HOUR || 30);
const MAX_CONNECTIONS_PER_USER = Number(process.env.MAX_CONNECTIONS_PER_USER || 5);
// per-account quotas
const MAX_USER_STORAGE_BYTES = Number(process.env.MAX_USER_STORAGE_BYTES || 5 * 1024 * 1024 * 1024);
const MAX_OWNED_GROUPS_PER_USER = Number(process.env.MAX_OWNED_GROUPS_PER_USER || 20);
const MAX_GROUP_MEMBERSHIPS_PER_USER = Number(process.env.MAX_GROUP_MEMBERSHIPS_PER_USER || 100);
const MAX_FRIENDS = Number(process.env.MAX_FRIENDS || 500);
const MAX_PENDING_OUTGOING_REQUESTS = Number(process.env.MAX_PENDING_OUTGOING_REQUESTS || 50);
// extra browser origins allowed to call the API/socket (comma-separated), on
// top of APP_URL and the request's own host — see http/originGuard.ts.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map((o) => o.trim().replace(/\/+$/, '')).filter(Boolean);
// production-like unless NODE_ENV says otherwise; only used to allow the Vite dev origin.
const IS_DEV = process.env.NODE_ENV === 'development' || (!process.env.NODE_ENV && !process.env.APP_URL);
// Discord posts call activity ONLY for this one conversation (opt-in); empty = off.
const DISCORD_WEBHOOK_CONVERSATION_ID = (process.env.DISCORD_WEBHOOK_CONVERSATION_ID || '').trim();
// files on disk with no `attachments` row are only collected after this long,
// so an upload that is still being committed is never mistaken for an orphan.
const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000;
// the scheduled orphan sweep only REPORTS unless this is '0' (an admin can still
// run a real one by hand from /admin). Deleting files is opt-in on purpose.
const ORPHAN_SWEEP_DRY_RUN = process.env.ORPHAN_SWEEP_DRY_RUN !== '0';

export const config = {
  PORT, HOST_BIND, MAX_PARTICIPANTS, TRUST_PROXY, MAX_MSG_BYTES, RECONNECT_GRACE_MS,
  MAX_AVATAR_LEN, MAX_BANNER_LEN, MAX_PROFILE_BIO_LEN, MAX_PROFILE_LINKS, MAX_PROFILE_LINK_LEN,
  MAX_CHAT_LEN, CHAT_HISTORY_LIMIT, SEARCH_RESULT_LIMIT, MAX_SEARCH_QUERY_LEN, MAX_ATTACHMENTS_PER_MESSAGE, ATTACH_TO_MESSAGE_WINDOW_MS,
  FRIEND_REQUEST_COOLDOWN_MS, GROUP_INVITATION_TTL_MS, GROUP_INVITATION_RESEND_COOLDOWN_MS, MAX_GROUP_MEMBERS, MAX_INVITEES_PER_REQUEST,
  UPLOAD_DIR, MAX_ATTACHMENT_BYTES, MAX_STORAGE_BYTES, MAX_AVATAR_BYTES,
  UPLOAD_CHUNK_BYTES, UPLOAD_SESSION_TTL_MS,
  DATABASE_URL, DATABASE_SSL, DATABASE_SSL_CA, MIGRATE_ON_BOOT,
  SESSION_COOKIE, SESSION_TTL_DAYS, REGISTRATION_CODE,
  COOKIE_SECURE, MAX_BODY_BYTES,
  MIN_USERNAME_LEN, MAX_USERNAME_LEN, MAX_DISPLAY_NAME_LEN, MIN_PASSWORD_LEN, MAX_PASSWORD_LEN,
  RESEND_API_KEY, RESEND_FROM_EMAIL, APP_URL, AUTH_CODE_TTL_MS, AUTH_CODE_MAX_ATTEMPTS,
  LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_ROOM_NAME, LIVEKIT_TOKEN_TTL_SECONDS,
  DISCORD_WEBHOOK_URL,
  UPLOADS_REMOTE_URL,
  REGISTRATIONS_PER_IP_PER_HOUR, MAX_NEW_ACCOUNTS_PER_HOUR, MAX_CONNECTIONS_PER_USER,
  MAX_USER_STORAGE_BYTES, MAX_OWNED_GROUPS_PER_USER, MAX_GROUP_MEMBERSHIPS_PER_USER, MAX_FRIENDS, MAX_PENDING_OUTGOING_REQUESTS,
  ALLOWED_ORIGINS, IS_DEV, DISCORD_WEBHOOK_CONVERSATION_ID, ORPHAN_GRACE_MS, ORPHAN_SWEEP_DRY_RUN,
};

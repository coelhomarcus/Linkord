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
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

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
// registering with this username becomes admin; a unique index makes it a
// one-time claim.
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'lune';
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

// LiveKit Cloud — camera/screen become real WebRTC (managed SFU).
const LIVEKIT_URL = process.env.LIVEKIT_URL || '';
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || '';
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || '';
// prefix for each group call's LiveKit room name (see
// realtime/livekit.ts) — one room per group, not a single shared one.
const LIVEKIT_ROOM_NAME = process.env.LIVEKIT_ROOM_NAME || 'linkord-room';

// optional — notifies a Discord channel when someone joins the call or
// starts sharing (see modules/discordWebhook.ts). Empty disables it silently.
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || '';

export const config = {
  PORT, HOST_BIND, MAX_PARTICIPANTS, TRUST_PROXY, MAX_MSG_BYTES, RECONNECT_GRACE_MS,
  MAX_AVATAR_LEN, MAX_BANNER_LEN, MAX_PROFILE_BIO_LEN, MAX_PROFILE_LINKS, MAX_PROFILE_LINK_LEN,
  MAX_CHAT_LEN, CHAT_HISTORY_LIMIT, SEARCH_RESULT_LIMIT, MAX_SEARCH_QUERY_LEN, MAX_ATTACHMENTS_PER_MESSAGE, ATTACH_TO_MESSAGE_WINDOW_MS,
  UPLOAD_DIR, MAX_ATTACHMENT_BYTES, MAX_STORAGE_BYTES, MAX_AVATAR_BYTES,
  UPLOAD_CHUNK_BYTES, UPLOAD_SESSION_TTL_MS,
  DATABASE_URL, DATABASE_SSL, DATABASE_SSL_CA, MIGRATE_ON_BOOT,
  SESSION_COOKIE, SESSION_TTL_DAYS, REGISTRATION_CODE, ADMIN_USERNAME,
  COOKIE_SECURE, MAX_BODY_BYTES,
  MIN_USERNAME_LEN, MAX_USERNAME_LEN, MAX_DISPLAY_NAME_LEN, MIN_PASSWORD_LEN, MAX_PASSWORD_LEN,
  LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_ROOM_NAME,
  DISCORD_WEBHOOK_URL,
};

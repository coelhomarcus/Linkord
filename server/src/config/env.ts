import path from 'node:path';

function numberEnv(name: string, fallback: number, options: { min: number; max: number; integer?: boolean }): number {
  const raw = process.env[name];
  const value = raw == null || raw === '' ? fallback : Number(raw);
  const mustBeInteger = options.integer !== false;
  if (!Number.isFinite(value) || (mustBeInteger && !Number.isInteger(value)) || value < options.min || value > options.max) {
    throw new Error(`${name} deve ser um numero${mustBeInteger ? ' inteiro' : ''} entre ${options.min} e ${options.max}.`);
  }
  return value;
}

const PORT = numberEnv('PORT', 3000, { min: 1, max: 65535 });
const HOST_BIND = process.env.HOST_BIND || '0.0.0.0';
const MAX_PARTICIPANTS = numberEnv('MAX_PARTICIPANTS', 50, { min: 1, max: 10_000 });
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
// Socket.IO TRANSPORT cap (kills the connection if exceeded), not app
// validation — video/uploads don't go through the socket, so 64KB is
// plenty for signaling.
const MAX_MSG_BYTES = numberEnv('MAX_MSG_BYTES', 64 * 1024, { min: 1024, max: 1024 * 1024 });
// how long a dropped connection's identity is held for reconnection before
// counting as "left".
const RECONNECT_GRACE_MS = numberEnv('RECONNECT_GRACE_MS', 30_000, { min: 0, max: 5 * 60 * 1000 });
const MAX_AVATAR_LEN = 500;
const MAX_CHAT_LEN = 2000;
const CHAT_HISTORY_LIMIT = 50; // messages kept to give context to whoever joins later

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
// network in plaintext. '1' enables TLS for servers that accept but don't
// present a Node-verifiable cert.
const DATABASE_SSL = process.env.DATABASE_SSL === '1';
// runs pending migrations before accepting connections — on by default
// since neither deploy path (Docker CMD, systemd ExecStart) goes through
// an npm script.
const MIGRATE_ON_BOOT = process.env.MIGRATE_ON_BOOT !== '0';

const SESSION_COOKIE = process.env.SESSION_COOKIE || 'ss_session';
const SESSION_TTL_DAYS = numberEnv('SESSION_TTL_DAYS', 30, { min: 1, max: 365 });
// closed by default: fail-closed so a deploy that forgot to set this
// doesn't become open registration.
const REGISTRATION_CODE = process.env.REGISTRATION_CODE || '';
// Separate, optional bootstrap secret. Supplying this in the existing
// registration code field creates the FIRST administrator only. A public,
// predictable username must never grant privileges by itself.
const ADMIN_REGISTRATION_CODE = process.env.ADMIN_REGISTRATION_CODE || '';
if (ADMIN_REGISTRATION_CODE && ADMIN_REGISTRATION_CODE.length < 16) {
  throw new Error('ADMIN_REGISTRATION_CODE deve ter pelo menos 16 caracteres aleatorios.');
}
if (ADMIN_REGISTRATION_CODE && ADMIN_REGISTRATION_CODE === REGISTRATION_CODE) {
  throw new Error('ADMIN_REGISTRATION_CODE deve ser diferente de REGISTRATION_CODE.');
}
// 'auto' reads X-Forwarded-Proto (set by Caddy/nginx); '1'/'0' force it —
// otherwise the Secure cookie attribute breaks local http:// dev.
const COOKIE_SECURE = process.env.COOKIE_SECURE || 'auto';
// HTTP request body (login/register JSON) — unrelated to MAX_MSG_BYTES
// (Socket.IO's own transport cap).
const MAX_BODY_BYTES = 8 * 1024;
const MIN_USERNAME_LEN = 3;
const MAX_USERNAME_LEN = 20;
const MIN_PASSWORD_LEN = 8;
const MAX_PASSWORD_LEN = 200; // hygiene cap — hashing a 1MB password would be a DoS vector

// LiveKit Cloud — camera/screen become real WebRTC (managed SFU).
const LIVEKIT_URL = process.env.LIVEKIT_URL || '';
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || '';
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || '';
// prefix for each voice channel's LiveKit room name (see
// realtime/livekit.ts) — one room per channel, not a single shared one.
const LIVEKIT_ROOM_NAME = process.env.LIVEKIT_ROOM_NAME || 'linkord-room';

// optional — notifies a Discord channel when someone joins the call or
// starts sharing (see modules/discordWebhook.ts). Empty disables it silently.
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL || '';

export const config = {
  PORT, HOST_BIND, MAX_PARTICIPANTS, TRUST_PROXY, MAX_MSG_BYTES, RECONNECT_GRACE_MS,
  MAX_AVATAR_LEN, MAX_CHAT_LEN, CHAT_HISTORY_LIMIT,
  UPLOAD_DIR, MAX_ATTACHMENT_BYTES, MAX_STORAGE_BYTES, MAX_AVATAR_BYTES,
  UPLOAD_CHUNK_BYTES, UPLOAD_SESSION_TTL_MS,
  DATABASE_URL, DATABASE_SSL, MIGRATE_ON_BOOT,
  SESSION_COOKIE, SESSION_TTL_DAYS, REGISTRATION_CODE, ADMIN_REGISTRATION_CODE,
  COOKIE_SECURE, MAX_BODY_BYTES,
  MIN_USERNAME_LEN, MAX_USERNAME_LEN, MIN_PASSWORD_LEN, MAX_PASSWORD_LEN,
  LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_ROOM_NAME,
  DISCORD_WEBHOOK_URL,
};

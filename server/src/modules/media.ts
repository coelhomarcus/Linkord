import { eq, and, lt, desc, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config/env.js';
import { db } from '../db/client.js';
import { messages, channels, attachments as attachmentsTable } from '../db/schema.js';
import { sendJson, sendError } from '../http/respond.js';
import { parseCookies } from '../http/cookies.js';
import { resolveSession } from './auth/session.js';
import { firstEmbed, type DetectedEmbed } from './link-preview/embeds.js';

// GET /api/media — Settings "Media" tab: aggregates every uploaded
// attachment and every embeddable link across ALL channels, newest first.
// Two lists (?kind=uploads or embeds), each cursor-paginated
// (?before=<msgId>, exclusive) instead of offset — a cursor can't skip or
// repeat an item if a new message arrives between two "load more" clicks.
//
// uploads is one exact query (the attachments innerJoin already filters to
// message-with-attachment). embeds must scan message TEXT in JS (mirrors
// web/src/shared/lib/chatEmbeds.ts) since not every link becomes an embed —
// the SQL filter (~* 'https?://') only narrows candidates; fetchEmbedsPage
// scans in batches until it collects `limit` real embeds or the table runs out.

const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 60;
const EMBED_BATCH_SIZE = 40;
// cap on rows scanned per call, even without reaching `limit` embeds —
// avoids an expensive loop if a channel has hundreds of non-embed links.
// "Load more" resumes exactly from the cursor (see nextBefore).
const EMBED_SCAN_CEILING = 400;
// messages.id is a 4-byte `serial` — using Number.MAX_SAFE_INTEGER as the
// "no cursor yet" sentinel overflows Postgres's int4 range. This is the
// column's real ceiling.
const PG_INT4_MAX = 2147483647;

interface MediaBaseRow {
  msgId: number;
  channelId: string;
  channelName: string;
  authorName: string;
  authorAvatar: string;
  createdAt: Date;
}

interface MediaBase {
  msgId: number;
  channelId: string;
  channelName: string;
  authorName: string;
  authorAvatar: string;
  ts: number;
}

interface UploadItem extends MediaBase {
  attachment: { id: string; name: string; mime: string; size: number };
}

interface EmbedItem extends MediaBase {
  embed: DetectedEmbed;
}

function toMediaBase(row: MediaBaseRow): MediaBase {
  return {
    msgId: row.msgId,
    channelId: row.channelId,
    channelName: row.channelName,
    authorName: row.authorName,
    authorAvatar: row.authorAvatar,
    ts: row.createdAt.getTime(),
  };
}

async function fetchUploadsPage(before: number | null, limit: number): Promise<{ items: UploadItem[]; nextBefore: number | null }> {
  const rows = await db
    .select({
      msgId: messages.id,
      channelId: messages.channelId,
      channelName: channels.name,
      authorName: messages.authorName,
      authorAvatar: messages.authorAvatar,
      createdAt: messages.createdAt,
      attachmentId: attachmentsTable.id,
      fileName: attachmentsTable.fileName,
      mimeType: attachmentsTable.mimeType,
      size: attachmentsTable.size,
    })
    .from(messages)
    // innerJoin (not left) on attachments.message_id=messages.id already
    // filters to message-with-attachment — avatars (message_id NULL) never
    // match, no extra filter needed.
    .innerJoin(attachmentsTable, eq(attachmentsTable.messageId, messages.id))
    .innerJoin(channels, eq(channels.id, messages.channelId))
    .where(lt(messages.id, before ?? PG_INT4_MAX))
    .orderBy(desc(messages.id))
    .limit(limit);

  const items: UploadItem[] = rows.map((row) => ({
    ...toMediaBase(row),
    attachment: { id: row.attachmentId, name: row.fileName, mime: row.mimeType, size: row.size },
  }));
  return { items, nextBefore: rows.length === limit ? rows[rows.length - 1]!.msgId : null };
}

async function fetchEmbedsPage(before: number | null, limit: number): Promise<{ items: EmbedItem[]; nextBefore: number | null }> {
  const items: EmbedItem[] = [];
  let cursor = before ?? null;
  let exhausted = false;
  let scanned = 0;

  while (items.length < limit && scanned < EMBED_SCAN_CEILING) {
    const batch = await db
      .select({
        msgId: messages.id,
        channelId: messages.channelId,
        channelName: channels.name,
        authorName: messages.authorName,
        authorAvatar: messages.authorAvatar,
        createdAt: messages.createdAt,
        text: messages.text,
      })
      .from(messages)
      .innerJoin(channels, eq(channels.id, messages.channelId))
      .where(and(lt(messages.id, cursor ?? PG_INT4_MAX), sql`${messages.text} ~* ${'https?://'}`))
      .orderBy(desc(messages.id))
      .limit(EMBED_BATCH_SIZE);

    if (batch.length === 0) { exhausted = true; break; }
    scanned += batch.length;

    // if `limit` is hit MID-BATCH, we stop consuming it without knowing if
    // more candidates existed past that point — so a short batch here does
    // NOT by itself mean "end of table" (it's short because we gave up
    // early, not because the rows ran out).
    let stoppedEarly = false;
    for (const row of batch) {
      // cursor ALWAYS advances, even when a candidate doesn't become an
      // embed — this is what lets the next call ("load more" again) resume
      // exactly here, without re-scanning or skipping anything.
      cursor = row.msgId;
      const embed = firstEmbed(row.text);
      if (embed) {
        items.push({ ...toMediaBase(row), embed });
        if (items.length >= limit) { stoppedEarly = true; break; }
      }
    }
    // only here, with the FULL batch consumed, does a short batch actually
    // mean the table ran out.
    if (!stoppedEarly && batch.length < EMBED_BATCH_SIZE) { exhausted = true; break; }
  }

  return { items, nextBefore: exhausted ? null : cursor };
}

async function handleMedia(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const cookies = parseCookies(request.headers.cookie || '');
  const sess = await resolveSession(cookies[config.SESSION_COOKIE]);
  if (!sess) return sendError(reply, 401, 'unauthenticated', 'Nao autenticado.');

  const query = request.query as Record<string, string | undefined>;
  const kind = query.kind === 'embeds' ? 'embeds' : 'uploads';
  const beforeRaw = query.before;
  const before = beforeRaw && /^\d+$/.test(beforeRaw) ? Number(beforeRaw) : null;
  const limitRaw = Number(query.limit);
  const limit = Math.min(Math.max(Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : DEFAULT_LIMIT, 1), MAX_LIMIT);

  const page = kind === 'embeds' ? await fetchEmbedsPage(before, limit) : await fetchUploadsPage(before, limit);
  sendJson(reply, 200, page);
}

export function registerMediaRoutes(fastify: FastifyInstance): void {
  fastify.get('/api/media', handleMedia);
}

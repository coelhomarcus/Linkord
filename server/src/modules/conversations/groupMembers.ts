import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { and, asc, eq, sql } from 'drizzle-orm';
import { config } from '../../config/env.js';
import { db } from '../../db/client.js';
import { conversationMembers, conversations, users } from '../../db/schema.js';
import { sendJson, sendError } from '../../http/respond.js';
import { parseCookies } from '../../http/cookies.js';
import { resolveSession } from '../auth/session.js';
import { toSocialUser, type SocialUser } from '../users/users.js';
import { SOCIAL_PAGE_SIZE, decodeTimeCursor, encodeTimeCursor } from '../friendships/cursor.js';
import { conversationExistsForUser } from './conversationsRepository.js';

export interface GroupMemberEntry { user: SocialUser; role: 'owner' | 'member'; at: string }

const joinedAtIso = sql<string>`to_char(${conversationMembers.joinedAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

/** One page of a group's members, oldest membership first. Members only: the
 * list of who is in a group is not something a non-member gets to read
 * (docs/plano-rede-social.md §4.2.6). */
export async function listGroupMembers(
  viewerId: string, conversationId: string, cursorRaw?: string,
): Promise<{ items: GroupMemberEntry[]; nextCursor: string | null } | 'not_found' | 'invalid_cursor'> {
  const cursor = cursorRaw ? decodeTimeCursor(cursorRaw) : null;
  if (cursorRaw && !cursor) return 'invalid_cursor';
  if (!(await conversationExistsForUser(conversationId, viewerId))) return 'not_found';
  const [group] = await db.select({ type: conversations.type }).from(conversations).where(eq(conversations.id, conversationId)).limit(1);
  if (group?.type !== 'group') return 'not_found';

  const rows = await db
    .select({ ts: joinedAtIso, role: conversationMembers.role, user: users })
    .from(conversationMembers)
    .innerJoin(users, eq(users.id, conversationMembers.userId))
    .where(and(
      eq(conversationMembers.conversationId, conversationId),
      cursor ? sql`(${conversationMembers.joinedAt}, ${conversationMembers.userId}) > (${cursor.ts}::timestamptz, ${cursor.id})` : undefined,
    ))
    .orderBy(asc(conversationMembers.joinedAt), asc(conversationMembers.userId))
    .limit(SOCIAL_PAGE_SIZE + 1);
  const page = rows.slice(0, SOCIAL_PAGE_SIZE);
  const last = page[page.length - 1];
  return {
    items: page.map((r) => ({ user: toSocialUser(r.user), role: r.role as 'owner' | 'member', at: r.ts })),
    nextCursor: rows.length > SOCIAL_PAGE_SIZE && last ? encodeTimeCursor(last.ts, last.user.id) : null,
  };
}

async function handleListMembers(request: FastifyRequest<{ Params: { conversationId: string }; Querystring: { cursor?: string } }>, reply: FastifyReply): Promise<void> {
  const cookies = parseCookies(request.headers.cookie || '');
  const sess = await resolveSession(cookies[config.SESSION_COOKIE]);
  if (!sess) return sendError(reply, 401, 'unauthenticated', 'Não autenticado.');
  const page = await listGroupMembers(sess.userId, String(request.params.conversationId || ''), request.query.cursor);
  if (page === 'not_found') return sendError(reply, 404, 'not_found', 'Grupo não encontrado.');
  if (page === 'invalid_cursor') return sendError(reply, 400, 'invalid_cursor', 'Cursor inválido.');
  sendJson(reply, 200, page);
}

export function registerGroupMemberRoutes(fastify: FastifyInstance): void {
  fastify.get('/api/groups/:conversationId/members', handleListMembers);
}

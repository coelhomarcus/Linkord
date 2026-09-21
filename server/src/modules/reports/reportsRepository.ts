import crypto from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { conversationMembers, conversations, messages, reports, users } from '../../db/schema.js';
import { areFriends } from '../friendships/friendshipsRepository.js';
import { shareAnyConversation } from '../conversations/conversationsRepository.js';
import { buildMessageSnapshot, type ReportInput } from './reportsPolicy.js';

export type CreateReportResult = { code: 'ok'; id: string } | { code: 'not_found' | 'invalid_target' };

/** Files a report. A reporter can only report what they can already SEE: an
 * account they have a relationship with (friend, shared conversation), a group
 * they are in, a message in a conversation they are in. Anything else answers
 * `not_found` — reporting is not a way to probe whether an id exists. A repeat
 * report of the same open case is accepted quietly and not duplicated. */
export async function createReport(reporterId: string, input: ReportInput): Promise<CreateReportResult> {
  const target = await resolveTarget(reporterId, input);
  if ('code' in target) return target;

  const id = crypto.randomUUID();
  const inserted = await db.insert(reports).values({
    id, reporterId, targetType: input.targetType, targetId: input.targetId, targetLabel: target.label,
    category: input.category, details: input.details, snapshot: target.snapshot,
  }).onConflictDoNothing().returning({ id: reports.id });
  return { code: 'ok', id: inserted[0]?.id ?? id };
}

async function resolveTarget(reporterId: string, input: ReportInput): Promise<{ label: string; snapshot: Record<string, unknown> } | { code: 'not_found' | 'invalid_target' }> {
  if (input.targetType === 'user') {
    if (input.targetId === reporterId) return { code: 'invalid_target' };
    const [target] = await db.select({ username: users.username }).from(users).where(eq(users.id, input.targetId)).limit(1);
    if (!target) return { code: 'not_found' };
    if (!(await areFriends(reporterId, input.targetId)) && !(await shareAnyConversation(reporterId, input.targetId))) return { code: 'not_found' };
    return { label: target.username, snapshot: {} };
  }

  if (input.targetType === 'group') {
    const [row] = await db.select({ title: conversations.title })
      .from(conversationMembers)
      .innerJoin(conversations, eq(conversations.id, conversationMembers.conversationId))
      .where(and(eq(conversationMembers.conversationId, input.targetId), eq(conversationMembers.userId, reporterId), eq(conversations.type, 'group')))
      .limit(1);
    return row ? { label: row.title, snapshot: {} } : { code: 'not_found' };
  }

  const msgId = Number(input.targetId);
  if (!Number.isInteger(msgId)) return { code: 'not_found' };
  const [msg] = await db.select({
    text: messages.text, authorId: messages.authorId, kind: messages.kind, createdAt: messages.createdAt,
    conversationId: messages.conversationId, conversationTitle: conversations.title, authorUsername: users.username,
  })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .innerJoin(conversationMembers, and(eq(conversationMembers.conversationId, messages.conversationId), eq(conversationMembers.userId, reporterId)))
    .leftJoin(users, eq(users.id, messages.authorId))
    .where(eq(messages.id, msgId))
    .limit(1);
  if (!msg) return { code: 'not_found' };
  if (msg.authorId === reporterId || msg.kind !== 'text') return { code: 'invalid_target' };
  return {
    label: `mensagem de ${msg.authorUsername ?? 'conta apagada'}`,
    snapshot: buildMessageSnapshot({ text: msg.text, authorId: msg.authorId, authorUsername: msg.authorUsername, conversationId: msg.conversationId, conversationTitle: msg.conversationTitle, createdAt: msg.createdAt }),
  };
}

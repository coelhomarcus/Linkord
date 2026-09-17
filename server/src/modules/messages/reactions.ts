import { and, asc, eq, inArray } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { messageReactions } from '../../db/schema.js';

interface ReactionRow {
  messageId: number;
  userId: string;
  emoji: string;
}

/** Pure grouping step, split out of getByMessageIds so it can be tested
 * without a database (see reactions.test.ts) — rows must already be in
 * insertion order (createdAt asc) for the per-emoji userId order to match
 * who reacted first. */
export function groupReactionRows(rows: ReactionRow[]): Map<number, Record<string, string[]>> {
  const map = new Map<number, Record<string, string[]>>();
  for (const row of rows) {
    let byEmoji = map.get(row.messageId);
    if (!byEmoji) { byEmoji = {}; map.set(row.messageId, byEmoji); }
    (byEmoji[row.emoji] ??= []).push(row.userId);
  }
  return map;
}

export async function getByMessageIds(messageIds: number[]): Promise<Map<number, Record<string, string[]>>> {
  if (!messageIds.length) return new Map();
  const rows = await db.select({
    messageId: messageReactions.messageId,
    userId: messageReactions.userId,
    emoji: messageReactions.emoji,
  }).from(messageReactions)
    .where(inArray(messageReactions.messageId, messageIds))
    .orderBy(asc(messageReactions.createdAt));
  return groupReactionRows(rows);
}

/** Atomic toggle: tries to insert first, letting the primary key itself be
 * the race-free decision point — if the insert lands, the reaction is now
 * "on"; if ON CONFLICT DO NOTHING inserted nothing, it was already there,
 * so this call means "off" and it deletes that exact row. No transaction
 * needed: there's no read-modify-write to protect (see chat.ts#handleChatReact,
 * which replaced a lost-update-prone JSONB read-modify-write with this). */
export async function toggle(messageId: number, userId: string, emoji: string): Promise<string[]> {
  const inserted = await db.insert(messageReactions)
    .values({ messageId, userId, emoji })
    .onConflictDoNothing()
    .returning({ userId: messageReactions.userId });
  if (inserted.length === 0) {
    await db.delete(messageReactions).where(and(
      eq(messageReactions.messageId, messageId),
      eq(messageReactions.userId, userId),
      eq(messageReactions.emoji, emoji),
    ));
  }
  const rows = await db.select({ userId: messageReactions.userId }).from(messageReactions)
    .where(and(eq(messageReactions.messageId, messageId), eq(messageReactions.emoji, emoji)));
  return rows.map((r) => r.userId);
}

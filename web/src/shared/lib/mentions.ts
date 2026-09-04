import type { PublicUser } from '../../types/protocol';

// same charset/length as the server's username validation (see
// server/src/modules/auth/routes.ts#USERNAME_RE) — a mention is just
// "@" + a valid username, resolved client-side against the account
// directory (allUsers). No new protocol field: the raw "@username" lives
// in the message text like any other chat message, same as link embeds.
export const MENTION_RE = /@([A-Za-z0-9_.-]{1,20})/g;

/** Lowercase username -> user, for case-insensitive @mention lookup —
 * usernames are unique case-insensitively (see db/schema.ts), so "@Lune"
 * and "@lune" must resolve to the same account. */
export function buildMentionLookup(allUsers: Map<string, PublicUser>): Map<string, PublicUser> {
  const lookup = new Map<string, PublicUser>();
  for (const u of allUsers.values()) lookup.set(u.username.toLowerCase(), u);
  return lookup;
}

/** True if `text` contains an @mention that resolves to `userId` — used to
 * highlight a message that mentions me, Discord-style. */
export function mentionsUser(text: string, lookup: Map<string, PublicUser>, userId: string | null): boolean {
  if (!userId || !lookup.size) return false;
  for (const match of text.matchAll(MENTION_RE)) {
    const user = lookup.get(match[1]!.toLowerCase());
    if (user && user.id === userId) return true;
  }
  return false;
}

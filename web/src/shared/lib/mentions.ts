import type { PublicUser } from '../../types/protocol';

export const MENTION_RE = /@([A-Za-z0-9_.-]{1,20})/g;

export function buildMentionLookup(allUsers: Map<string, PublicUser>): Map<string, PublicUser> {
  const lookup = new Map<string, PublicUser>();
  for (const u of allUsers.values()) lookup.set(u.username.toLowerCase(), u);
  return lookup;
}

export function mentionsUser(text: string, lookup: Map<string, PublicUser>, userId: string | null): boolean {
  if (!userId || !lookup.size) return false;
  for (const match of text.matchAll(MENTION_RE)) {
    const user = lookup.get(match[1]!.toLowerCase());
    if (user && user.id === userId) return true;
  }
  return false;
}

export function mentionsUsername(text: string, username: string | null): boolean {
  if (!username) return false;
  const lower = username.toLowerCase();
  for (const match of text.matchAll(MENTION_RE)) {
    if (match[1]!.toLowerCase() === lower) return true;
  }
  return false;
}

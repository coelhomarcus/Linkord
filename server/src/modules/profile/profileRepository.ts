import { eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { users, type User } from '../../db/schema.js';
import { invalidateSessionsForUser } from '../auth/session.js';

export async function updateProfile(id: string, profile: { avatar: string; avatarPoster: string; avatarColor: string; displayName: string; banner: string; bannerPoster: string; bio: string; profileLinks: string[] }): Promise<User | null> {
  const [row] = await db
    .update(users)
    .set({
      avatar: profile.avatar,
      avatarPoster: profile.avatarPoster,
      avatarColor: profile.avatarColor,
      displayName: profile.displayName,
      banner: profile.banner,
      bannerPoster: profile.bannerPoster,
      bio: profile.bio,
      profileLinks: profile.profileLinks,
      updatedAt: new Date(),
    })
    .where(eq(users.id, id))
    .returning();
  invalidateSessionsForUser(id);
  return row || null;
}

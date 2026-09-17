import { and, eq, or, sql } from 'drizzle-orm';
import { config } from '../config/env.js';
import { db } from '../db/client.js';
import { users } from '../db/schema.js';
import { deleteAvatarFile } from './attachments.js';
import { encodeAndStoreProfileImage } from './avatarUpload.js';
import { fetchImageFromUrl } from './imageFetch.js';

const MAX_CONCURRENT_USERS = 3;

export type LegacyProfileImageField = 'avatar' | 'banner';

export interface LegacyProfileImageUser {
  id: string;
  avatar: string;
  banner: string;
}

export function isLegacyProfileImageUrl(value: unknown): value is string {
  return typeof value === 'string' && /^https?:\/\/\S+$/i.test(value.trim());
}

type MigrationResult = { migrated: number; failed: number };
type StoredProfileImage = Awaited<ReturnType<typeof encodeAndStoreProfileImage>>;

export interface LegacyProfileImageMigrationDeps {
  fetchImage: typeof fetchImageFromUrl;
  encodeAndStore: typeof encodeAndStoreProfileImage;
  removeStoredImage: (result: StoredProfileImage) => Promise<void>;
}

async function removeStoredImage(result: StoredProfileImage): Promise<void> {
  await Promise.all([
    deleteAvatarFile(result.avatar),
    result.avatarPoster ? deleteAvatarFile(result.avatarPoster) : Promise.resolve(),
  ]);
}

async function migrateField(
  user: LegacyProfileImageUser,
  field: LegacyProfileImageField,
  deps: LegacyProfileImageMigrationDeps,
): Promise<MigrationResult> {
  const sourceUrl = user[field];
  if (!isLegacyProfileImageUrl(sourceUrl)) return { migrated: 0, failed: 0 };

  let stored: StoredProfileImage | null = null;
  try {
    const fetched = await deps.fetchImage(sourceUrl.trim(), config.MAX_AVATAR_BYTES);
    if ('error' in fetched) throw new Error(`${fetched.error}: ${fetched.message}`);

    stored = await deps.encodeAndStore(fetched.buffer, null);
    const values = field === 'avatar'
      ? { avatar: stored.avatar, avatarPoster: stored.avatarPoster ?? '' }
      : { banner: stored.avatar, bannerPoster: stored.avatarPoster ?? '' };
    const where = field === 'avatar'
      ? and(eq(users.id, user.id), eq(users.avatar, sourceUrl))
      : and(eq(users.id, user.id), eq(users.banner, sourceUrl));
    const updated = await db.update(users).set(values).where(where).returning({ id: users.id });

    // The profile changed while the background migration was downloading the
    // image. Do not overwrite the newer value; the temporary upload is safe
    // to remove because it was never assigned to the account.
    if (!updated.length) {
      await deps.removeStoredImage(stored);
      stored = null;
      return { migrated: 0, failed: 0 };
    }

    return { migrated: 1, failed: 0 };
  } catch (err) {
    if (stored) {
      await deps.removeStoredImage(stored).catch((cleanupErr) => {
        console.warn(`[avatar] falha ao limpar imagem temporária de ${field} do usuário ${user.id}:`, cleanupErr instanceof Error ? cleanupErr.message : cleanupErr);
      });
    }
    console.warn(`[avatar] falha ao migrar ${field} do usuário ${user.id}:`, err instanceof Error ? err.message : err);
    return { migrated: 0, failed: 1 };
  }
}

async function migrateUser(user: LegacyProfileImageUser, deps: LegacyProfileImageMigrationDeps): Promise<MigrationResult> {
  // Keep both fields independent, but process them serially for this user so
  // the user-level concurrency cap also bounds simultaneous downloads.
  const avatar = await migrateField(user, 'avatar', deps);
  const banner = await migrateField(user, 'banner', deps);
  return { migrated: avatar.migrated + banner.migrated, failed: avatar.failed + banner.failed };
}

/** Downloads and internalizes profile images that predate the server-side
 * "Usar URL" upload flow. Failures stay external and are retried on the next
 * boot, while already migrated rows no longer match the candidate query. */
export async function migrateLegacyProfileImages(
  overrides: Partial<LegacyProfileImageMigrationDeps> = {},
): Promise<void> {
  const deps: LegacyProfileImageMigrationDeps = {
    fetchImage: fetchImageFromUrl,
    encodeAndStore: encodeAndStoreProfileImage,
    removeStoredImage,
    ...overrides,
  };
  const candidates = await db
    .select({ id: users.id, avatar: users.avatar, banner: users.banner })
    .from(users)
    .where(or(
      sql`${users.avatar} ~ '^https?://'`,
      sql`${users.banner} ~ '^https?://'`,
    ));

  let nextIndex = 0;
  let migrated = 0;
  let failed = 0;
  const workerCount = Math.min(MAX_CONCURRENT_USERS, candidates.length);

  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = nextIndex++;
      const user = candidates[index];
      if (!user) return;
      const result = await migrateUser(user, deps);
      migrated += result.migrated;
      failed += result.failed;
    }
  }));

  console.log(`[avatar] migração de imagens legadas concluída: ${migrated} migradas, ${failed} falhas.`);
}

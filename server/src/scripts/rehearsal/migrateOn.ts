import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Pool } from 'pg';
import { assertMigrationsSafe } from '../../modules/migration/migrationGate.js';

/** The boot path (safety gate, then the drizzle runner), pointed at any pool
 * and any migrations folder. */
export async function migrateOn(pool: Pool, folder: string): Promise<void> {
  await assertMigrationsSafe(pool);
  await migrate(drizzle(pool), { migrationsFolder: folder });
}

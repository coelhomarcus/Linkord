import type { Config } from 'drizzle-kit';

export default {
  dialect: 'postgresql',
  schema: './server/src/db/schema.ts',
  out: './server/db/migrations',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
  strict: true,
  verbose: true,
} satisfies Config;

import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { config } from '../config/env.js';
import * as schema from './schema.js';

// Single Postgres connection, shared by the whole server.
if (!config.DATABASE_URL) {
  throw new Error('DATABASE_URL nao configurada — sem banco nao ha login (ver .env.example).');
}

export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  ssl: config.DATABASE_SSL ? { rejectUnauthorized: false } : undefined,
});

// without this listener, an error on an IDLE pool client (DB restarted,
// firewall killed the connection) becomes an unhandled 'error' that Node
// turns into an uncaughtException — taking down the whole room over one
// stale connection.
pool.on('error', (err) => {
  console.error('[db] erro em conexao ociosa do pool:', err instanceof Error ? err.stack : err);
});

export const db = drizzle(pool, { schema });
export { schema };

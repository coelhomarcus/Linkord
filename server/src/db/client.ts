import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { config } from '../config/env.js';
import * as schema from './schema.js';

// Single Postgres connection, shared by the whole server.
if (!config.DATABASE_URL) {
  throw new Error('DATABASE_URL nao configurada — sem banco nao ha login (ver .env.example).');
}

// Cert verification always stays ON when TLS is used — accepting ANY
// certificate (the old `rejectUnauthorized: false`) makes the encryption
// pointless: an active MITM just presents its own cert and the client
// trusts it, over the exact connection that carries DB credentials and
// every session. For a self-signed/private-CA Postgres that the public
// trust store can't validate, pin DATABASE_SSL_CA instead of disabling
// verification.
export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  ssl: config.DATABASE_SSL
    ? { rejectUnauthorized: true, ...(config.DATABASE_SSL_CA ? { ca: config.DATABASE_SSL_CA } : {}) }
    : undefined,
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

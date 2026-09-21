import { Pool } from 'pg';

// Throwaway databases for the migration rehearsal and the integration suite.
// The guards are deliberately strict: these tools CREATE and DROP databases, so
// they must never be pointed at anything that could be a real one.

export const ISOLATED_NAME_RE = /^linkord_(test|rehearsal)_[a-z0-9_]{1,40}$/;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export const isSafeIsolatedName = (name: string): boolean => ISOLATED_NAME_RE.test(name) && !/prod/i.test(name);

export function isLocalDatabaseUrl(url: string): boolean {
  try { return LOCAL_HOSTS.has(new URL(url).hostname); } catch { return false; }
}

/** Same server and credentials, another database name. */
export function withDatabase(url: string, database: string): string {
  const u = new URL(url);
  u.pathname = `/${database}`;
  return u.toString();
}

export interface IsolatedDatabase {
  name: string;
  url: string;
  pool: Pool;
  drop(): Promise<void>;
}

/** Creates `linkord_<kind>_<suffix>` on the local Postgres behind `baseUrl`.
 * Refuses a non-local host outright. */
export async function createIsolatedDatabase(baseUrl: string, kind: 'test' | 'rehearsal', suffix = Date.now().toString(36)): Promise<IsolatedDatabase> {
  if (!isLocalDatabaseUrl(baseUrl)) throw new Error('Recusado: o ensaio e os testes de integração só rodam contra um Postgres local (localhost/127.0.0.1).');
  const name = `linkord_${kind}_${suffix}`.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  if (!isSafeIsolatedName(name)) throw new Error(`Nome de banco isolado inválido: ${name}`);

  const admin = new Pool({ connectionString: withDatabase(baseUrl, 'postgres'), max: 1 });
  try {
    await admin.query(`create database "${name}"`);
  } finally {
    await admin.end();
  }
  const url = withDatabase(baseUrl, name);
  const pool = new Pool({ connectionString: url, max: 6 });
  return {
    name, url, pool,
    async drop() {
      await pool.end().catch(() => {});
      const dropper = new Pool({ connectionString: withDatabase(baseUrl, 'postgres'), max: 1 });
      try {
        await dropper.query(`drop database if exists "${name}" with (force)`);
      } finally {
        await dropper.end();
      }
    },
  };
}

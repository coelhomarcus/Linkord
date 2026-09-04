import path from 'node:path';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db, pool } from './client.js';

// server/db/migrations nunca muda de lugar (fica fora de src/, gerado pelo
// drizzle-kit) — compilado, este arquivo vira server/dist/db/migrate.js, daí
// os dois '..' pra sair de dist/db ate server/, e entrar em db/migrations.
const MIGRATIONS_FOLDER = path.join(import.meta.dirname, '..', '..', 'db', 'migrations');

/** Aplica as migrations pendentes. Usado tanto no boot do servidor
 * (src/index.ts) quanto pelo `npm run db:migrate` — o runner mora em
 * drizzle-orm (nao no drizzle-kit, que e devDependency), entao a imagem de
 * producao (sem devDependencies) ainda consegue migrar. */
export async function runMigrations(): Promise<void> {
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}

export { MIGRATIONS_FOLDER };

// Rodado direto pela linha de comando: aplica e encerra o processo.
if (process.argv[1] === import.meta.filename) {
  runMigrations()
    .then(() => { console.log('Migrations aplicadas.'); return pool.end(); })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Falha ao aplicar migrations:', err instanceof Error ? err.stack : err);
      process.exit(1);
    });
}

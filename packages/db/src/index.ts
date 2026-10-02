// Opens the studio database and brings its schema up to date. Locally that is PGlite: a folder
// (.harness/db) for the daemon, or memory for throwaway test daemons. One process may open a
// folder at a time; the daemon's lock (.harness/daemon.json) guarantees that.
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import * as schema from './schema.ts';

export * from './schema.ts';
export { schema };

const MIGRATIONS = path.join(import.meta.dirname, '../drizzle');

export type Database = ReturnType<typeof drizzle<typeof schema>>;

export async function openDatabase(opts: { dataDir: string } | { memory: true }) {
  const client = 'dataDir' in opts ? new PGlite(opts.dataDir) : new PGlite();
  await client.waitReady;
  const db = drizzle({ client, schema });
  await migrate(db, { migrationsFolder: MIGRATIONS });
  return {
    db,
    async close() {
      await client.close();
    },
  };
}

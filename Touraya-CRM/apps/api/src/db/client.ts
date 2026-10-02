import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import * as schema from './schema';

export type Schema = typeof schema;
export type Db = PgDatabase<PgQueryResultHKT, Schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
/** Anything that can run queries: the db itself or an open transaction. */
export type DbOrTx = Db | Tx;

export interface Database {
  db: Db;
  close: () => Promise<void>;
}

/** apps/api/drizzle — reached from src/db (dev) or dist (bundled build). */
function defaultMigrationsFolder(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const found = ['../drizzle', '../../drizzle'].map((p) => path.resolve(here, p)).find((p) => existsSync(p));
  if (!found) throw new Error('Migrations folder not found');
  return found;
}
const migrationsFolderFor = (dir?: string) => dir ?? process.env.MIGRATIONS_DIR ?? defaultMigrationsFolder();

/**
 * Postgres in production; embedded PGlite (real Postgres compiled to WASM)
 * when no DATABASE_URL is given — zero-setup local dev and fast tests.
 * Migrations are applied on startup.
 */
export async function openDatabase(opts: { url?: string; pgliteDir?: string; migrationsDir?: string }): Promise<Database> {
  const folder = migrationsFolderFor(opts.migrationsDir);
  if (opts.url) {
    const { default: postgres } = await import('postgres');
    const { drizzle } = await import('drizzle-orm/postgres-js');
    const { migrate } = await import('drizzle-orm/postgres-js/migrator');
    const client = postgres(opts.url, { max: 10, onnotice: () => {} });
    const db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: folder });
    return { db: db as unknown as Db, close: () => client.end() };
  }

  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const { migrate } = await import('drizzle-orm/pglite/migrator');
  const client = opts.pgliteDir === 'memory' ? new PGlite() : new PGlite(opts.pgliteDir);
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: folder });
  return { db: db as unknown as Db, close: () => client.close() };
}

import { loadConfig } from './config';
import { openDatabase } from './db/client';
import { buildApp } from './app';
import { getSettings } from './modules/settings/service';
import { ensureBootstrap } from './seed';

const config = loadConfig();
const database = await openDatabase({ url: config.DATABASE_URL, pgliteDir: config.PGLITE_DIR });
await ensureBootstrap(database.db);
await getSettings(database.db); // kept in memory: the night pause is checked without the database
const app = await buildApp(config, database.db);

const shutdown = async () => {
  await app.close();
  await database.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: config.PORT, host: config.HOST });
if (!config.DATABASE_URL) app.log.warn(`DATABASE_URL not set — using embedded PGlite at ${config.PGLITE_DIR}`);

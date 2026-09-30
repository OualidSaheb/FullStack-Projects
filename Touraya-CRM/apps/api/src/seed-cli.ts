/** npm run db:seed [-- --demo] — creates the admin/products/sources, optionally demo orders. */
import { loadConfig } from './config';
import { openDatabase } from './db/client';
import { ensureBootstrap, seedDemo } from './seed';

const config = loadConfig();
const database = await openDatabase({ url: config.DATABASE_URL, pgliteDir: config.PGLITE_DIR });
await ensureBootstrap(database.db);
if (process.argv.includes('--demo')) await seedDemo(database.db);
await database.close();

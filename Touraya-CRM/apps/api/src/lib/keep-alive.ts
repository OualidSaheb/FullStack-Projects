import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { cachedSettings, inNightPause } from '../modules/settings/service';

/** The database host lets an idle database sleep after 5 minutes: a tiny query every 4 keeps it awake. */
const DB_EVERY_MS = 4 * 60_000;
/** The web host sleeps after 15 minutes without a visit from outside: a visit to itself every 10. */
const WEB_EVERY_MS = 10 * 60_000;

/**
 * "Always on" (settings): pages open at once, no waking up. Off, or during
 * the night pause, nothing is done and both hosts may sleep.
 */
export function keepAlive(app: FastifyInstance) {
  if (app.config.NODE_ENV === 'test') return;
  const on = () => (cachedSettings()?.alwaysOn ?? true) && !inNightPause();
  // Through the public address: only outside visits count for the host.
  const self = (app.config.PUBLIC_URL ?? process.env.RENDER_EXTERNAL_URL)?.replace(/\/$/, '');
  const db = setInterval(() => {
    if (on()) void app.db.execute(sql`select 1`).catch((err) => app.log.warn({ err }, 'keep-alive: database'));
  }, DB_EVERY_MS);
  const web = setInterval(() => {
    if (on() && self) void fetch(`${self}/api/health`, { signal: AbortSignal.timeout(20_000) }).catch(() => undefined);
  }, WEB_EVERY_MS);
  app.addHook('onClose', async () => {
    clearInterval(db);
    clearInterval(web);
  });
}

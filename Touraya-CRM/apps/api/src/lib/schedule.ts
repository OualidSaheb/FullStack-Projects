import type { FastifyInstance } from 'fastify';
import { getSettings, inNightPause } from '../modules/settings/service';

const TICK_MS = 60_000;
const jobs: { name: string; every: number | (() => number); last: number; run: () => Promise<unknown> }[] = [];

/**
 * Background work (Facebook safety pull, carrier status check…), run together
 * so they share one database wake-up, skipped during the night pause and run
 * at once when it ends (the night's leads and parcel news come in then).
 */
export function scheduleJob(app: FastifyInstance, name: string, everyMs: number | (() => number), run: () => Promise<unknown>) {
  if (app.config.NODE_ENV === 'test') return;
  jobs.push({ name, every: everyMs, last: 0, run });
  if (jobs.length > 1) return;
  const tick = async () => {
    // Settings come from memory when known: a sleeping database is not woken just to read them.
    if (inNightPause()) return;
    for (const job of jobs) {
      if (Date.now() - job.last < (typeof job.every === 'function' ? job.every() : job.every)) continue;
      job.last = Date.now();
      await job.run().catch((err) => app.log.warn({ err }, `${job.name} failed`));
    }
  };
  const first = setTimeout(() => void getSettings(app.db).catch(() => null).then(tick), 30_000);
  const timer = setInterval(() => void tick(), TICK_MS);
  app.addHook('onClose', async () => {
    clearTimeout(first);
    clearInterval(timer);
    jobs.length = 0;
  });
}

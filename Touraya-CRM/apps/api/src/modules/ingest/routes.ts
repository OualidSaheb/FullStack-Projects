import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { ingestSchema } from '@touraya/shared';
import { z } from 'zod';
import { sources } from '../../db/schema';
import { HttpError } from '../../lib/errors';
import { ingestRows } from './service';

const sheetBody = ingestSchema.extend({
  spreadsheetId: z.string(),
  /** Drive folder script: the files and tabs it sees (hourly). */
  files: z
    .array(z.object({ spreadsheetId: z.string(), name: z.string(), tabs: z.array(z.object({ name: z.string(), rows: z.number().int() })).max(200) }))
    .max(1000)
    .optional(),
});

/** Any JSON: one lead, an array of leads, or {rows:[{values}]}. Field names are mapped like sheet headers. */
function toRows(body: unknown) {
  const b = body as { rows?: unknown; leads?: unknown };
  const list = Array.isArray(body) ? body : Array.isArray(b?.leads) ? b.leads : Array.isArray(b?.rows) ? b.rows : [body];
  return list.slice(0, 500).map((item, i) => {
    const values = (item as { values?: unknown })?.values ?? item;
    if (!values || typeof values !== 'object') throw new HttpError(400, 'invalid lead payload');
    return { rowNumber: i + 1, values: values as Record<string, unknown> };
  });
}

function cors(reply: FastifyReply) {
  reply.header('Access-Control-Allow-Origin', '*').header('Access-Control-Allow-Headers', 'Content-Type').header('Access-Control-Allow-Methods', 'POST, OPTIONS');
}

/** Public endpoints, authenticated by the per-source token. */
export const ingestRoutes: FastifyPluginAsync = async (app) => {
  async function sourceByToken(token: unknown, type?: 'webhook') {
    if (typeof token !== 'string' || !token) throw new HttpError(401, 'missing token');
    const [source] = await app.db.select().from(sources).where(and(eq(sources.token, token), eq(sources.active, true)));
    if (!source || (type && source.type !== type)) throw new HttpError(401, 'invalid token');
    return source;
  }

  /** Google Apps Script. */
  app.post('/ingest/sheets', { bodyLimit: 10 * 1024 * 1024 }, async (req) => {
    const source = await sourceByToken(req.headers['x-touraya-token']);
    if (source.type === 'webhook') throw new HttpError(401, 'invalid token');
    const body = sheetBody.parse(req.body);
    // Guards against pasting one offer's script into another offer's sheet (the Drive script reads any file of its folder).
    if (source.type === 'google_sheet' && body.spreadsheetId !== source.spreadsheetId) throw new HttpError(409, 'spreadsheet mismatch');
    if (!body.rows.length) {
      // "Still alive" ping: only refresh the last-contact time (keeps the last batch stats) and the files seen.
      await app.db.update(sources).set({ lastSyncAt: new Date(), ...(body.files ? { files: body.files } : {}) }).where(eq(sources.id, source.id));
      return { received: 0, created: 0, duplicates: 0, skipped: 0, errors: [], results: [] };
    }
    const { createdIds, ...summary } = await ingestRows(app.db, source, body);
    if (createdIds.length) app.events.emit('order.created', createdIds.map((orderId) => ({ orderId, sourceId: source.id })));
    req.log.info({ source: source.name, sheet: body.sheetName, created: summary.created, duplicates: summary.duplicates }, 'sheet sync');
    return summary;
  });

  /** Generic webhook: website order form, Make/Zapier, Shopify/WooCommerce automations… */
  app.options('/ingest/:token', async (_req, reply) => {
    cors(reply);
    return reply.code(204).send();
  });
  app.post('/ingest/:token', { bodyLimit: 2 * 1024 * 1024 }, async (req, reply) => {
    cors(reply);
    const source = await sourceByToken((req.params as { token: string }).token, 'webhook');
    const { createdIds, results: _r, ...summary } = await ingestRows(app.db, source, { sheetName: 'webhook', rows: toRows(req.body) });
    if (createdIds.length) app.events.emit('order.created', createdIds.map((orderId) => ({ orderId, sourceId: source.id })));
    return { ...summary, orderIds: createdIds };
  });
};

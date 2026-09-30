import type { FastifyPluginAsync } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { ingestSchema } from '@touraya/shared';
import { z } from 'zod';
import { sources } from '../../db/schema';
import { HttpError } from '../../lib/errors';
import { ingestRows } from './service';

const bodySchema = ingestSchema.extend({ spreadsheetId: z.string() });

/** Public endpoint called by the Google Apps Script; authenticated by the per-source token. */
export const ingestRoutes: FastifyPluginAsync = async (app) => {
  app.post('/ingest/sheets', { bodyLimit: 10 * 1024 * 1024 }, async (req) => {
    const token = req.headers['x-touraya-token'];
    if (typeof token !== 'string' || !token) throw new HttpError(401, 'missing token');
    const [source] = await app.db.select().from(sources).where(and(eq(sources.token, token), eq(sources.active, true)));
    if (!source) throw new HttpError(401, 'invalid token');

    const body = bodySchema.parse(req.body);
    // Guards against pasting one offer's script into another offer's sheet.
    if (body.spreadsheetId !== source.spreadsheetId) throw new HttpError(409, 'spreadsheet mismatch');

    const { results, ...summary } = await ingestRows(app.db, source, body);
    req.log.info({ source: source.name, sheet: body.sheetName, ...summary, errors: summary.errors.length }, 'sheet sync');
    return { ...summary, results };
  });
};

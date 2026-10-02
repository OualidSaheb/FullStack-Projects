import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { fieldMapSchema, ingestSchema, resolveHeaders, sourceSchema, type SourceDTO } from '@touraya/shared';
import { orders, sources } from '../../db/schema';
import { randomToken } from '../../lib/crypto';
import { notFound } from '../../lib/errors';
import { ingestRows, reprocessSource } from '../ingest/service';
import { renderAppsScript } from './apps-script';

const idParams = z.object({ id: z.coerce.number().int() });

type SourceRow = typeof sources.$inferSelect;

function toDTO(s: SourceRow, orderCount = 0): SourceDTO {
  const { token: _token, createdAt: _c, updatedAt: _u, deletedAt: _d, lastSyncAt, ...rest } = s;
  return { ...rest, lastSyncAt: lastSyncAt?.toISOString() ?? null, orderCount };
}

export function publicUrl(app: { config: { PUBLIC_URL?: string } }, req: FastifyRequest): string {
  return (app.config.PUBLIC_URL ?? `${req.protocol}://${req.host}`).replace(/\/$/, '');
}

export const sourceRoutes: FastifyPluginAsync = async (app) => {
  const manage = { preHandler: app.requirePermission('sources.manage') };

  async function load(id: number) {
    const [s] = await app.db.select().from(sources).where(and(eq(sources.id, id), isNull(sources.deletedAt)));
    if (!s) throw notFound('المصدر غير موجود');
    return s;
  }

  app.get('/sources', { preHandler: app.requireAuth }, async () => {
    const [rows, counts] = await Promise.all([
      app.db.select().from(sources).where(isNull(sources.deletedAt)).orderBy(asc(sources.id)),
      app.db
        .select({ sourceId: orders.sourceId, n: sql<number>`count(*)::int` })
        .from(orders)
        .where(isNull(orders.deletedAt))
        .groupBy(orders.sourceId),
    ]);
    const bySource = new Map(counts.map((c) => [c.sourceId, c.n]));
    return rows.map((s) => toDTO(s, bySource.get(s.id) ?? 0));
  });

  app.post('/sources', manage, async (req) => {
    const input = sourceSchema.parse(req.body);
    const [s] = await app.db.insert(sources).values({ ...input, token: randomToken() }).returning();
    return toDTO(s!);
  });

  app.put('/sources/:id', manage, async (req) => {
    const { id } = idParams.parse(req.params);
    const input = sourceSchema.parse(req.body);
    const [s] = await app.db.update(sources).set({ ...input, updatedAt: new Date() }).where(eq(sources.id, id)).returning();
    if (!s) throw notFound();
    return toDTO(s);
  });

  /**
   * Removes a source: it stops receiving (the script's key is revoked at once)
   * and disappears from the lists. Its orders and statistics are kept.
   */
  app.delete('/sources/:id', manage, async (req) => {
    const { id } = idParams.parse(req.params);
    const [s] = await app.db
      .update(sources)
      .set({ deletedAt: new Date(), active: false, token: randomToken() })
      .where(and(eq(sources.id, id), isNull(sources.deletedAt)))
      .returning({ id: sources.id });
    if (!s) throw notFound();
    return { ok: true };
  });

  /** Invalidates the previous script (e.g. if the code leaked). */
  app.post('/sources/:id/rotate-token', manage, async (req) => {
    const { id } = idParams.parse(req.params);
    await app.db.update(sources).set({ token: randomToken() }).where(eq(sources.id, id));
    return { ok: true };
  });

  /** Where a webhook source posts its orders (website form, Make/Zapier…). */
  app.get('/sources/:id/endpoint', manage, async (req) => {
    const s = await load(idParams.parse(req.params).id);
    return { url: `${publicUrl(app, req)}/api/ingest/${s.token}` };
  });

  app.get('/sources/:id/apps-script', manage, async (req, reply) => {
    const s = await load(idParams.parse(req.params).id);
    const code = renderAppsScript({
      sourceName: s.name,
      endpoint: `${publicUrl(app, req)}/api/ingest/sheets`,
      token: s.token,
      spreadsheetId: s.spreadsheetId,
      sheets: s.sheetNames,
      startDate: s.importFrom,
      syncMinutes: s.syncMinutes,
    });
    return reply.type('text/plain; charset=utf-8').send(code);
  });

  /** Shows which sheet column feeds each order field (Facebook questions mapping screen). */
  app.post('/sources/:id/preview-mapping', manage, async (req) => {
    const s = await load(idParams.parse(req.params).id);
    const body = z.object({ headers: z.array(z.string()).optional(), fieldMap: fieldMapSchema.optional() }).parse(req.body ?? {});
    const headers = body.headers ?? s.lastHeaders;
    return { headers, mapping: resolveHeaders(headers, body.fieldMap ?? s.fieldMap) };
  });

  /** After fixing the column mapping: fill the empty fields of existing orders from their original answers. */
  app.post('/sources/:id/reprocess', manage, async (req) => {
    const s = await load(idParams.parse(req.params).id);
    return reprocessSource(app.db, s, req.user.id);
  });

  /** Legacy import: rows parsed from a CSV export of the sheet, same pipeline as the live sync. */
  app.post('/sources/:id/import', manage, async (req) => {
    const s = await load(idParams.parse(req.params).id);
    const body = ingestSchema.extend({ importFrom: z.string().date().optional() }).parse(req.body);
    const { results: _results, createdIds, ...summary } = await ingestRows(app.db, s, body, { importFrom: body.importFrom, actorId: req.user.id });
    if (createdIds.length) app.events.emit('order.created', createdIds.map((orderId) => ({ orderId, sourceId: s.id })));
    return summary;
  });
};

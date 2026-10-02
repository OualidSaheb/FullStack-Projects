import type { FastifyPluginAsync } from 'fastify';
import { and, eq, or } from 'drizzle-orm';
import { z } from 'zod';
import { exportRequestSchema } from '@touraya/shared';
import { parseReference, type AppContext } from '../../context';
import { carriers, exportBatches, orders } from '../../db/schema';
import { notFound } from '../../lib/errors';
import { ADAPTERS } from '../carriers/registry';
import { getCarrier } from '../carriers/service';
import type { LoadedCarrier, WebhookUpdate } from '../carriers/types';
import { logEvents } from '../orders/events';
import { emitStatusEvents, transitionContext, type StatusEvent } from '../orders/service';
import { transitionStatus } from '../orders/transitions';
import { FILE_TYPES, renderFile } from './file';
import { createExportBatch, listBatches, previewExport, sendViaApi } from './service';

export const shippingRoutes: FastifyPluginAsync = async (app) => {
  const exporter = { preHandler: app.requirePermission('shipping.export') };

  app.post('/shipping/preview', exporter, async (req) => {
    const { ids, carrierId } = exportRequestSchema.parse(req.body);
    return previewExport(app, ids, carrierId);
  });

  app.post('/shipping/exports', exporter, async (req) => {
    const { ids, carrierId } = exportRequestSchema.parse(req.body);
    return createExportBatch(app, ids, req.user, carrierId);
  });

  app.get('/shipping/exports', exporter, async () => listBatches(app.db));

  app.get('/shipping/exports/:id/file', exporter, async (req, reply) => {
    const { id } = z.object({ id: z.coerce.number().int() }).parse(req.params);
    const [batch] = await app.db.select().from(exportBatches).where(eq(exportBatches.id, id));
    if (!batch) throw notFound();
    const format = batch.fileName.endsWith('.csv') ? 'csv' : 'xlsx';
    return reply
      .type(FILE_TYPES[format])
      .header('Content-Disposition', `attachment; filename="${batch.fileName}"`)
      .send(await renderFile(format, batch.headers, batch.rows));
  });

  app.post('/shipping/send', exporter, async (req) => {
    const { ids, carrierId } = exportRequestSchema.parse(req.body);
    return sendViaApi(app, ids, req.user, carrierId);
  });
};

/** Applies carrier status updates to orders (matched by tracking, then by our reference). */
export async function applyCarrierUpdates(ctx: AppContext, carrier: LoadedCarrier, updates: WebhookUpdate[]) {
  const adapter = ADAPTERS[carrier.provider];
  let applied = 0;
  const events: (StatusEvent | null)[] = [];
  for (const u of updates) {
    const number = u.reference ? parseReference(u.reference) : null;
    const conds = [u.tracking ? eq(orders.carrierTracking, u.tracking) : undefined, number ? eq(orders.number, number) : undefined].filter(Boolean);
    if (!conds.length) continue;
    await ctx.db.transaction(async (tx) => {
      const matches = await tx.select().from(orders).where(or(...conds));
      for (const order of matches) {
        await tx
          .update(orders)
          .set({ ...(u.carrierStatus ? { carrierStatus: u.carrierStatus } : {}), ...(u.tracking ? { carrierTracking: u.tracking } : {}), updatedAt: new Date() })
          .where(eq(orders.id, order.id));
        await logEvents(tx, { orderId: order.id, type: 'carrier_update', data: { event: u.event, carrierStatus: u.carrierStatus, tracking: u.tracking, carrier: carrier.name } });
        const mapped = u.carrierStatus ? adapter?.mapStatus(u.carrierStatus) : null;
        // Never move an order back from "return received" (the parcel is already on the shelf).
        if (mapped && order.status !== 'return_received')
          events.push(await transitionStatus(await transitionContext(ctx, tx, null), order, mapped, { meta: { via: carrier.provider } }));
        applied++;
      }
    });
  }
  emitStatusEvents(ctx, events);
  return applied;
}

/**
 * Carrier webhooks. Must answer 2xx quickly, otherwise the carrier marks it
 * failing ("not2xx"). GET = validation handshake, POST = parcel events.
 * /webhooks/yalidine stays as an alias for the default Yalidine carrier.
 */
export const carrierWebhookRoutes: FastifyPluginAsync = async (app) => {
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => done(null, body));

  async function resolve(params: { id?: string }) {
    if (params.id) return getCarrier(app.db, app.secrets, Number(params.id));
    const [row] = await app.db.select({ id: carriers.id }).from(carriers).where(and(eq(carriers.provider, 'yalidine'), eq(carriers.active, true))).limit(1);
    return getCarrier(app.db, app.secrets, row?.id);
  }

  const handshake = async (req: { params: unknown; query: unknown }, reply: { type: (t: string) => { send: (b: string) => unknown } }) => {
    const carrier = await resolve(req.params as { id?: string }).catch(() => null);
    const echo = carrier ? ADAPTERS[carrier.provider]?.handshake?.(req.query as Record<string, string>) : null;
    return reply.type('text/plain').send(echo ?? 'ok');
  };

  const receive = async (req: { params: unknown; body: unknown; headers: Record<string, string | string[] | undefined>; log: { warn: (m: string) => void; error: (o: object, m: string) => void } }) => {
    try {
      const carrier = await resolve(req.params as { id?: string });
      const adapter = ADAPTERS[carrier.provider];
      const raw = typeof req.body === 'string' ? req.body : '';
      if (!adapter?.parseWebhook) return { ok: false };
      if (adapter.verifyWebhook && !adapter.verifyWebhook(carrier, raw, req.headers)) {
        req.log.warn('carrier webhook: bad signature');
        return { ok: false };
      }
      return { ok: true, applied: await applyCarrierUpdates(app, carrier, adapter.parseWebhook(JSON.parse(raw || '{}'))) };
    } catch (err) {
      req.log.error({ err }, 'carrier webhook failed');
      return { ok: false };
    }
  };

  app.get('/webhooks/carriers/:id', handshake);
  app.post('/webhooks/carriers/:id', receive);
  app.get('/webhooks/yalidine', handshake);
  app.post('/webhooks/yalidine', receive);
};

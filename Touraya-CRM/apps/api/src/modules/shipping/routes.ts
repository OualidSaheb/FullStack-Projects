import type { FastifyPluginAsync } from 'fastify';
import { and, eq, inArray, isNotNull, isNull, or } from 'drizzle-orm';
import { z } from 'zod';
import { CARRIER_FINAL_STATUSES, exportRequestSchema, IN_TRANSIT_STATUSES, type OrderStatus } from '@touraya/shared';
import { parseReference, type AppContext } from '../../context';
import { carriers, exportBatches, orders } from '../../db/schema';
import { notFound } from '../../lib/errors';
import { ADAPTERS } from '../carriers/registry';
import { getCarrier, loadCarrierRow } from '../carriers/service';
import type { LoadedCarrier, WebhookUpdate } from '../carriers/types';
import { logEvents } from '../orders/events';
import { emitStatusEvents, transitionContext, type StatusEvent } from '../orders/service';
import { transitionStatus } from '../orders/transitions';
import { FILE_TYPES, renderFile } from './file';
import { linkExistingParcels, linkParcelManually, unlinkParcel } from './link';
import { createExportBatch, listBatches, previewExport, sendViaApi } from './service';

export const shippingRoutes: FastifyPluginAsync = async (app) => {
  const exporter = { preHandler: app.requirePermission('shipping.export') };
  /** Sending confirmed orders through the carrier API: managers, and agents when the setting allows it. */
  const sender = { preHandler: app.requirePermission('shipping.send') };

  app.post('/shipping/preview', sender, async (req) => {
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

  app.post('/shipping/send', sender, async (req) => {
    const { ids, carrierId } = exportRequestSchema.parse(req.body);
    return sendViaApi(app, ids, req.user, carrierId);
  });

  /** Parcels sent before the platform (carrier dashboard, Excel): preview, then link to their orders. */
  app.post('/shipping/link-existing', exporter, async (req) => {
    const { apply, trackings } = z.object({ apply: z.boolean().default(false), trackings: z.array(z.string()).max(5000).optional() }).parse(req.body ?? {});
    return linkExistingParcels(app, req.user, apply, trackings);
  });

  app.post('/shipping/link-manual', exporter, async (req) => {
    const input = z.object({ tracking: z.string().trim().min(3), reference: z.string().trim().min(1) }).parse(req.body);
    return linkParcelManually(app, req.user, input);
  });

  /** A wrong match from the carrier's list: back to the order's earlier status. */
  app.post('/shipping/unlink', exporter, async (req) => {
    const { orderId } = z.object({ orderId: z.string().uuid() }).parse(req.body);
    return unlinkParcel(app, req.user, orderId);
  });

  /** "Update now": ask the carrier for the status of every parcel on its way. */
  app.post('/shipping/sync', sender, async () => syncCarrierStatuses(app));

  // Behind the webhook: check every hour (a missed webhook, the platform asleep…). Not in tests.
  if (app.config.NODE_ENV !== 'test') {
    const timer = setInterval(() => void syncCarrierStatuses(app).catch((err) => app.log.warn({ err }, 'carrier status sync failed')), 60 * 60_000);
    app.addHook('onClose', async () => clearInterval(timer));
  }
};

/** Order of the delivery steps: a late update never moves a parcel back to an earlier step. */
const STEP: Partial<Record<OrderStatus, number>> = {
  ready_for_carrier: 0,
  sent_to_carrier: 1,
  carrier_received: 2,
  out_for_delivery: 3,
  at_desk: 3,
  delivery_failed: 3,
  delivered: 4,
  returned: 4,
  return_received: 5,
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
    const label = u.carrierStatus ? (u.reason ? `${u.carrierStatus} — ${u.reason}` : u.carrierStatus) : undefined;
    await ctx.db.transaction(async (tx) => {
      const matches = await tx.select().from(orders).where(or(...conds));
      for (const order of matches) {
        // Payment news (money collected / paid out): history only, the parcel's status stays.
        if (!u.carrierStatus) {
          if (u.payment) {
            await logEvents(tx, { orderId: order.id, type: 'carrier_update', data: { event: u.event, payment: u.payment, tracking: u.tracking, carrier: carrier.name } });
            applied++;
          }
          continue;
        }
        // Same news again (webhook + hourly check): nothing to record.
        if (label && label === order.carrierStatus && (!u.tracking || u.tracking === order.carrierTracking)) continue;
        const mapped = adapter?.mapStatus(u.carrierStatus) ?? null;
        // Never move an order back (an older event arriving late, "return received" already on the shelf…).
        const stale = mapped && ((STEP[mapped] ?? 99) < (STEP[order.status] ?? -1) || (CARRIER_FINAL_STATUSES.includes(order.status) && !CARRIER_FINAL_STATUSES.includes(mapped)));
        await tx
          .update(orders)
          .set({ ...(label && !stale ? { carrierStatus: label } : {}), ...(u.tracking ? { carrierTracking: u.tracking } : {}), updatedAt: new Date() })
          .where(eq(orders.id, order.id));
        await logEvents(tx, { orderId: order.id, type: 'carrier_update', data: { event: u.event, carrierStatus: u.carrierStatus, reason: u.reason, tracking: u.tracking, carrier: carrier.name } });
        if (mapped && !stale)
          events.push(await transitionStatus(await transitionContext(ctx, tx, null), order, mapped, { meta: { via: carrier.provider, ...(u.reason ? { reason: u.reason } : {}) } }));
        applied++;
      }
    });
  }
  emitStatusEvents(ctx, events);
  return applied;
}

/**
 * The regular check behind the webhook: asks each carrier with an API for the
 * current status of every parcel still on its way (a missed webhook, the
 * platform asleep…). Only real changes are recorded.
 */
export async function syncCarrierStatuses(ctx: AppContext) {
  const rows = await ctx.db.select().from(carriers).where(and(eq(carriers.active, true), eq(carriers.apiEnabled, true)));
  let checked = 0;
  let applied = 0;
  for (const row of rows) {
    const carrier = loadCarrierRow(ctx.secrets, row);
    const adapter = ADAPTERS[carrier.provider];
    if (!adapter?.fetchStatuses) continue;
    const open = await ctx.db
      .select({ tracking: orders.carrierTracking, label: orders.carrierStatus })
      .from(orders)
      .where(and(eq(orders.carrierId, carrier.id), isNotNull(orders.carrierTracking), isNull(orders.deletedAt), inArray(orders.status, IN_TRANSIT_STATUSES)));
    const trackings = open.map((o) => o.tracking!).filter(Boolean);
    if (!trackings.length) continue;
    const updates = await adapter.fetchStatuses(carrier, trackings, new Map(open.map((o) => [o.tracking!, o.label])));
    checked += trackings.length;
    applied += await applyCarrierUpdates(ctx, carrier, updates);
  }
  return { checked, applied };
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

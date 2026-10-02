import { desc, eq, inArray } from 'drizzle-orm';
import {
  buildExportRow,
  EXPORTABLE_STATUSES,
  STATUS_META,
  validateForCarrier,
  type ExportableOrder,
  type ExportBatchDTO,
  type OrderStatus,
} from '@touraya/shared';
import { formatReference, type AppContext } from '../../context';
import type { DbOrTx } from '../../db/client';
import { carriers, exportBatches, offers, orders, users } from '../../db/schema';
import type { SessionUser } from '../../lib/auth';
import { badRequest, unprocessable } from '../../lib/errors';
import { ADAPTERS } from '../carriers/registry';
import { getCarrier } from '../carriers/service';
import { CarrierError } from '../carriers/types';
import { logEvents } from '../orders/events';
import { itemsLabel, loadItems } from '../orders/items';
import { emitStatusEvents, transitionContext, type StatusEvent } from '../orders/service';
import { transitionStatus } from '../orders/transitions';

export type CarrierOrder = ExportableOrder & { status: OrderStatus; deleted: boolean; missingVariants: boolean };

export async function loadCarrierOrders(db: DbOrTx, ids: string[], prefix: string): Promise<CarrierOrder[]> {
  const [rows, items] = await Promise.all([
    db
      .select({
        id: orders.id,
        number: orders.number,
        status: orders.status,
        deletedAt: orders.deletedAt,
        customerName: orders.customerName,
        phone: orders.phone,
        phoneAlt: orders.phoneAlt,
        wilayaCode: orders.wilayaCode,
        communeName: orders.communeName,
        address: orders.address,
        productCarrierName: offers.carrierName,
        price: orders.price,
        deliveryType: orders.deliveryType,
        stopdeskId: orders.stopdeskId,
      })
      .from(orders)
      .leftJoin(offers, eq(offers.id, orders.offerId))
      .where(inArray(orders.id, ids))
      .orderBy(orders.number),
    loadItems(db, ids),
  ]);
  return rows.map(({ number, deletedAt, ...r }) => {
    const mine = items.filter((i) => i.orderId === r.id);
    return {
      ...r,
      reference: formatReference(prefix, number),
      deleted: Boolean(deletedAt),
      units: mine.reduce((n, i) => n + i.quantity, 0),
      itemsLabel: itemsLabel(mine),
      missingVariants: mine.some((i) => i.variantId === null),
    };
  });
}

/** Everything that blocks an order from going to the carrier, including its status. */
export function carrierProblems(o: CarrierOrder): string[] {
  const problems = validateForCarrier(o);
  if (o.deleted) problems.unshift('الطلبية محذوفة');
  else if (!EXPORTABLE_STATUSES.includes(o.status)) problems.unshift(`الحالة "${STATUS_META[o.status].label}" غير مؤكدة`);
  return problems;
}

/** Non-blocking remarks shown in the review (the parcel can still go). */
function carrierWarnings(o: CarrierOrder): string[] {
  return o.missingVariants ? ['مقاس/لون بعض القطع غير محدد — لن يُخصم من المخزون'] : [];
}

/** What the file will contain — shown to the user for review before anything changes. */
export async function previewExport(ctx: AppContext, ids: string[], carrierId?: number) {
  const carrier = await getCarrier(ctx.db, ctx.secrets, carrierId);
  const list = await loadCarrierOrders(ctx.db, ids, ctx.config.ORDER_PREFIX);
  return {
    carrier: { id: carrier.id, name: carrier.name, apiEnabled: carrier.apiEnabled && Boolean(ADAPTERS[carrier.provider]) },
    headers: carrier.config.exportColumns.map((c) => c.header),
    rows: list.map((o) => ({
      id: o.id,
      reference: o.reference,
      status: o.status,
      cells: buildExportRow(o, carrier.config.exportColumns),
      errors: carrierProblems(o),
      warnings: carrierWarnings(o),
    })),
  };
}

async function validated(db: DbOrTx, ids: string[], prefix: string) {
  const list = await loadCarrierOrders(db, ids, prefix);
  const invalid = list.map((o) => ({ id: o.id, reference: o.reference, errors: carrierProblems(o) })).filter((o) => o.errors.length);
  if (invalid.length || list.length !== ids.length) throw unprocessable('بعض الطلبيات غير جاهزة للتوصيل', { invalid });
  return list;
}

/**
 * Freezes a carrier file: snapshots the rows, moves the orders to "ready for
 * carrier" (stock goes out) and logs it. All-or-nothing.
 */
export async function createExportBatch(ctx: AppContext, ids: string[], user: SessionUser, carrierId?: number) {
  const carrier = await getCarrier(ctx.db, ctx.secrets, carrierId);
  const { exportColumns, exportFormat } = carrier.config;
  const events: (StatusEvent | null)[] = [];
  const batch = await ctx.db.transaction(async (tx) => {
    const list = await validated(tx, ids, ctx.config.ORDER_PREFIX);
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
    const [b] = await tx
      .insert(exportBatches)
      .values({
        carrierId: carrier.id,
        createdById: user.id,
        orderIds: ids,
        orderCount: list.length,
        totalAmount: list.reduce((n, o) => n + o.price, 0),
        headers: exportColumns.map((c) => c.header),
        rows: list.map((o) => buildExportRow(o, exportColumns)),
        fileName: `${carrier.name.toLowerCase().replace(/\W+/g, '-')}-${stamp}-${list.length}.${exportFormat}`,
      })
      .returning();
    await tx.update(orders).set({ exportBatchId: b!.id, carrierId: carrier.id }).where(inArray(orders.id, ids));
    const t = await transitionContext(ctx, tx, user);
    const rows = await tx.select().from(orders).where(inArray(orders.id, ids));
    for (const row of rows) events.push(await transitionStatus(t, row, 'ready_for_carrier', { meta: { batchId: b!.id } }));
    await logEvents(tx, ids.map((orderId) => ({ orderId, type: 'exported' as const, actorId: user.id, data: { batchId: b!.id, carrier: carrier.name } })));
    return b!;
  });
  emitStatusEvents(ctx, events);
  return { id: batch.id, fileName: batch.fileName };
}

/** Creates parcels through the carrier API. Every attempt (success or error) lands in the activity log. */
export async function sendViaApi(ctx: AppContext, ids: string[], user: SessionUser, carrierId?: number) {
  const carrier = await getCarrier(ctx.db, ctx.secrets, carrierId);
  const adapter = ADAPTERS[carrier.provider];
  if (!adapter || !carrier.apiEnabled) throw badRequest('الإرسال عبر API غير مفعل لهذه الشركة — استعمل ملف التوصيل');
  const list = await validated(ctx.db, ids, ctx.config.ORDER_PREFIX);

  let results;
  try {
    results = await adapter.createParcels(carrier, list);
  } catch (err) {
    const details = err instanceof CarrierError ? { message: err.message, ...err.details } : { message: String(err) };
    await logEvents(ctx.db, list.map((o) => ({ orderId: o.id, type: 'carrier_error' as const, actorId: user.id, data: { carrier: carrier.name, ...details } })));
    throw unprocessable(details.message, details);
  }

  const events: (StatusEvent | null)[] = [];
  for (const o of list) {
    const r = results.find((x) => x.reference === o.reference);
    await ctx.db.transaction(async (tx) => {
      if (r?.ok) {
        await tx.update(orders).set({ carrierTracking: r.tracking, carrierId: carrier.id }).where(eq(orders.id, o.id));
        await logEvents(tx, { orderId: o.id, type: 'carrier_sent', actorId: user.id, data: { tracking: r.tracking, carrier: carrier.name } });
        const [row] = await tx.select().from(orders).where(eq(orders.id, o.id));
        events.push(await transitionStatus(await transitionContext(ctx, tx, user), row!, 'sent_to_carrier'));
      } else {
        await logEvents(tx, { orderId: o.id, type: 'carrier_error', actorId: user.id, data: { message: r?.ok === false ? r.message : 'no response', carrier: carrier.name } });
      }
    });
  }
  emitStatusEvents(ctx, events);
  return { results: list.map((o) => results.find((r) => r.reference === o.reference) ?? { reference: o.reference, ok: false, message: 'no response' }) };
}

export async function listBatches(db: DbOrTx): Promise<ExportBatchDTO[]> {
  const rows = await db
    .select({ batch: exportBatches, createdByName: users.name, carrierName: carriers.name })
    .from(exportBatches)
    .leftJoin(users, eq(users.id, exportBatches.createdById))
    .leftJoin(carriers, eq(carriers.id, exportBatches.carrierId))
    .orderBy(desc(exportBatches.id))
    .limit(100);
  return rows.map(({ batch, createdByName, carrierName }) => ({
    id: batch.id,
    carrierName,
    orderCount: batch.orderCount,
    totalAmount: batch.totalAmount,
    createdAt: batch.createdAt.toISOString(),
    createdByName,
    fileName: batch.fileName,
  }));
}

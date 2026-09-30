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
import { exportBatches, orders, products, users } from '../../db/schema';
import type { SessionUser } from '../../lib/auth';
import { unprocessable } from '../../lib/errors';
import { logEvents } from '../orders/events';
import { getSettings } from '../settings/service';

export type CarrierOrder = ExportableOrder & { status: OrderStatus; deleted: boolean };

export async function loadCarrierOrders(db: DbOrTx, ids: string[], prefix: string): Promise<CarrierOrder[]> {
  const rows = await db
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
      productCarrierName: products.carrierName,
      quantity: orders.quantity,
      price: orders.price,
      size: orders.size,
      colors: orders.colors,
    })
    .from(orders)
    .leftJoin(products, eq(products.id, orders.productId))
    .where(inArray(orders.id, ids))
    .orderBy(orders.number);
  return rows.map(({ number, deletedAt, ...r }) => ({ ...r, reference: formatReference(prefix, number), deleted: Boolean(deletedAt) }));
}

/** Everything that blocks an order from going to the carrier, including its status. */
export function carrierProblems(o: CarrierOrder): string[] {
  const problems = validateForCarrier(o);
  if (o.deleted) problems.unshift('الطلبية محذوفة');
  else if (!EXPORTABLE_STATUSES.includes(o.status)) problems.unshift(`الحالة "${STATUS_META[o.status].label}" غير مؤكدة`);
  return problems;
}

/** What the file will contain — shown to the user for review before anything changes. */
export async function previewExport(ctx: AppContext, ids: string[]) {
  const { exportColumns } = await getSettings(ctx.db, ctx.secrets);
  const list = await loadCarrierOrders(ctx.db, ids, ctx.config.ORDER_PREFIX);
  return {
    headers: exportColumns.map((c) => c.header),
    rows: list.map((o) => ({ id: o.id, reference: o.reference, status: o.status, cells: buildExportRow(o, exportColumns), errors: carrierProblems(o) })),
  };
}

/**
 * Freezes a carrier file: snapshots the rows, marks the orders "ready for
 * carrier" and logs it. All-or-nothing — any invalid order aborts the batch.
 */
export async function createExportBatch(ctx: AppContext, ids: string[], user: SessionUser) {
  const { exportColumns, exportFormat } = await getSettings(ctx.db, ctx.secrets);
  return ctx.db.transaction(async (tx) => {
    const list = await loadCarrierOrders(tx, ids, ctx.config.ORDER_PREFIX);
    const invalid = list.map((o) => ({ id: o.id, reference: o.reference, errors: carrierProblems(o) })).filter((o) => o.errors.length);
    if (invalid.length || list.length !== ids.length) throw unprocessable('بعض الطلبيات غير جاهزة للتوصيل', { invalid });

    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
    const [batch] = await tx
      .insert(exportBatches)
      .values({
        createdById: user.id,
        orderIds: ids,
        orderCount: list.length,
        totalAmount: list.reduce((n, o) => n + o.price, 0),
        headers: exportColumns.map((c) => c.header),
        rows: list.map((o) => buildExportRow(o, exportColumns)),
        fileName: `livraison-${stamp}-${list.length}.${exportFormat}`,
      })
      .returning();

    await tx.update(orders).set({ status: 'ready_for_carrier', exportBatchId: batch!.id, updatedAt: new Date() }).where(inArray(orders.id, ids));
    await logEvents(
      tx,
      list.map((o) => ({ orderId: o.id, type: 'exported' as const, actorId: user.id, data: { batchId: batch!.id, from: o.status } })),
    );
    await logEvents(
      tx,
      list.filter((o) => o.status !== 'ready_for_carrier').map((o) => ({ orderId: o.id, type: 'status_changed' as const, actorId: user.id, data: { from: o.status, to: 'ready_for_carrier' } })),
    );
    return { id: batch!.id, fileName: batch!.fileName };
  });
}

export async function listBatches(db: DbOrTx): Promise<ExportBatchDTO[]> {
  const rows = await db
    .select({ batch: exportBatches, createdByName: users.name })
    .from(exportBatches)
    .leftJoin(users, eq(users.id, exportBatches.createdById))
    .orderBy(desc(exportBatches.id))
    .limit(100);
  return rows.map(({ batch, createdByName }) => ({
    id: batch.id,
    orderCount: batch.orderCount,
    totalAmount: batch.totalAmount,
    createdAt: batch.createdAt.toISOString(),
    createdByName,
    fileName: batch.fileName,
  }));
}

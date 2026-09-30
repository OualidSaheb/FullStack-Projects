import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import {
  CALL_ATTEMPT_STATUSES,
  can,
  getWilaya,
  normalizePhone,
  STATUS_META,
  type BulkAction,
  type OrderDetail,
  type OrderStatus,
  type OrderUpdate,
  type StatusChange,
} from '@touraya/shared';
import type { AppContext } from '../../context';
import type { Db, DbOrTx } from '../../db/client';
import { orderComments, orderEvents, orders, products, users } from '../../db/schema';
import { assertCan, type SessionUser } from '../../lib/auth';
import { badRequest, forbidden, notFound } from '../../lib/errors';
import { logEvents, type EventInput } from './events';
import { selectOrdersWithRelations, toListItem } from './query';

type OrderRow = typeof orders.$inferSelect;

async function loadOrder(db: DbOrTx, id: string): Promise<OrderRow> {
  const [order] = await db.select().from(orders).where(eq(orders.id, id));
  if (!order) throw notFound('الطلبية غير موجودة');
  return order;
}

export async function getOrderDetail(ctx: AppContext, id: string): Promise<OrderDetail> {
  const [row] = await selectOrdersWithRelations(ctx.db, {
    leadId: orders.leadId,
    phoneCustomer: orders.phoneCustomer,
    phoneFacebook: orders.phoneFacebook,
    phoneAlt: orders.phoneAlt,
    wilayaRaw: orders.wilayaRaw,
    address: orders.address,
    offerRaw: orders.offerRaw,
    carrierTracking: orders.carrierTracking,
    carrierStatus: orders.carrierStatus,
    raw: orders.raw,
    sheetName: orders.sheetName,
    sheetRow: orders.sheetRow,
  }).where(eq(orders.id, id));
  if (!row) throw notFound('الطلبية غير موجودة');
  const { leadId, phoneCustomer, phoneFacebook, phoneAlt, wilayaRaw, address, offerRaw, carrierTracking, carrierStatus, raw, sheetName, sheetRow, ...list } = row;
  return {
    ...toListItem(list, ctx.config.ORDER_PREFIX),
    leadId, phoneCustomer, phoneFacebook, phoneAlt, wilayaRaw, address, offerRaw, carrierTracking, carrierStatus, raw, sheetName, sheetRow,
  };
}

export async function getTimeline(db: Db, orderId: string) {
  const [comments, events] = await Promise.all([
    db
      .select({ id: orderComments.id, body: orderComments.body, authorName: users.name, createdAt: orderComments.createdAt })
      .from(orderComments)
      .leftJoin(users, eq(users.id, orderComments.authorId))
      .where(eq(orderComments.orderId, orderId))
      .orderBy(desc(orderComments.createdAt), desc(orderComments.id)),
    db
      .select({ id: orderEvents.id, type: orderEvents.type, data: orderEvents.data, actorName: users.name, createdAt: orderEvents.createdAt })
      .from(orderEvents)
      .leftJoin(users, eq(users.id, orderEvents.actorId))
      .where(eq(orderEvents.orderId, orderId))
      .orderBy(desc(orderEvents.createdAt), desc(orderEvents.id)),
  ]);
  const iso = <T extends { createdAt: Date }>(r: T) => ({ ...r, createdAt: r.createdAt.toISOString() });
  return { comments: comments.map(iso), events: events.map(iso) };
}

/** Fields derived from a status change (attempt counter, confirmation stamp, auto-assignment). */
function statusPatch(order: Pick<OrderRow, 'assignedToId' | 'callAttempts'>, status: OrderStatus, user: SessionUser) {
  const attempt = CALL_ATTEMPT_STATUSES.indexOf(status);
  return {
    status,
    updatedAt: new Date(),
    callAttempts: attempt >= 0 ? attempt + 1 : order.callAttempts,
    ...(status === 'confirmed' ? { confirmedById: user.id, confirmedAt: new Date() } : {}),
    // The first agent who works an unassigned order owns it (drives per-agent stats).
    ...(order.assignedToId === null && user.role === 'agent' ? { assignedToId: user.id } : {}),
  };
}

function assertStatusAllowed(user: SessionUser, status: OrderStatus) {
  assertCan(user, 'orders.status');
  if (!STATUS_META[status].manual && !can(user.role, 'orders.status.any'))
    throw forbidden('هذه الحالة تُحدد تلقائياً من التوصيل');
}

async function insertComment(tx: DbOrTx, orderId: string, body: string, user: SessionUser) {
  await tx.insert(orderComments).values({ orderId, authorId: user.id, body });
  await tx
    .update(orders)
    .set({ commentCount: sql`${orders.commentCount} + 1`, lastComment: body })
    .where(eq(orders.id, orderId));
  await logEvents(tx, { orderId, type: 'commented', actorId: user.id, data: { body } });
}

export async function changeStatus(ctx: AppContext, id: string, input: StatusChange, user: SessionUser) {
  assertStatusAllowed(user, input.status);
  await ctx.db.transaction(async (tx) => {
    const order = await loadOrder(tx, id);
    if (order.deletedAt) throw badRequest('الطلبية محذوفة');
    if (order.status === input.status && !input.comment) return;
    if (order.status !== input.status) {
      await tx.update(orders).set(statusPatch(order, input.status, user)).where(eq(orders.id, id));
      await logEvents(tx, { orderId: id, type: 'status_changed', actorId: user.id, data: { from: order.status, to: input.status } });
    }
    if (input.comment) await insertComment(tx, id, input.comment, user);
  });
  return getOrderDetail(ctx, id);
}

export async function addComment(ctx: AppContext, id: string, body: string, user: SessionUser) {
  await ctx.db.transaction(async (tx) => {
    await loadOrder(tx, id);
    await insertComment(tx, id, body, user);
  });
  return getTimeline(ctx.db, id);
}

const TRACKED_FIELDS = [
  'customerName', 'phone', 'phoneAlt', 'wilayaCode', 'communeName', 'address', 'productId', 'quantity', 'price', 'size', 'colors',
] as const;

export async function updateOrder(ctx: AppContext, id: string, input: OrderUpdate, user: SessionUser) {
  assertCan(user, 'orders.edit');
  await ctx.db.transaction(async (tx) => {
    const order = await loadOrder(tx, id);
    const { reason, ...fields } = input;
    const next: Partial<OrderRow> = { ...fields };

    if (fields.phone !== undefined) {
      const phone = normalizePhone(fields.phone);
      next.phone = phone.value || null;
      next.phoneIssue = phone.valid ? null : 'invalid';
    }
    if (fields.phoneAlt) next.phoneAlt = normalizePhone(fields.phoneAlt).value || null;
    if (fields.wilayaCode && !getWilaya(fields.wilayaCode)) throw badRequest('ولاية غير معروفة');

    // Offer / quantity change re-prices from the product list unless a price is given explicitly.
    const productChanged = fields.productId !== undefined && fields.productId !== order.productId;
    const qtyChanged = fields.quantity !== undefined && fields.quantity !== order.quantity;
    if ((productChanged || qtyChanged) && fields.price === undefined) {
      const productId = fields.productId ?? order.productId;
      if (productId) {
        const [product] = await tx.select({ price: products.price }).from(products).where(eq(products.id, productId));
        if (product) next.price = product.price * (fields.quantity ?? order.quantity);
      }
    }

    const changes: Record<string, [unknown, unknown]> = {};
    for (const key of TRACKED_FIELDS) {
      if (key in next && next[key] !== order[key]) changes[key] = [order[key], next[key]];
    }
    if (!Object.keys(changes).length) return;

    await tx.update(orders).set({ ...next, updatedAt: new Date() }).where(eq(orders.id, id));
    await logEvents(tx, { orderId: id, type: 'updated', actorId: user.id, data: { changes } });
    if (reason) await insertComment(tx, id, reason, user);
  });
  return getOrderDetail(ctx, id);
}

export async function bulkAction(ctx: AppContext, action: BulkAction, user: SessionUser) {
  const { ids } = action;
  const now = new Date();
  return ctx.db.transaction(async (tx) => {
    switch (action.action) {
      case 'status': {
        assertStatusAllowed(user, action.status);
        const rows = await tx
          .select({ id: orders.id, status: orders.status, assignedToId: orders.assignedToId, callAttempts: orders.callAttempts })
          .from(orders)
          .where(and(inArray(orders.id, ids), isNull(orders.deletedAt)));
        const changed = rows.filter((r) => r.status !== action.status);
        for (const r of changed) await tx.update(orders).set(statusPatch(r, action.status, user)).where(eq(orders.id, r.id));
        await logEvents(tx, changed.map((r) => ({ orderId: r.id, type: 'status_changed', actorId: user.id, data: { from: r.status, to: action.status, bulk: true } }) satisfies EventInput));
        return { affected: changed.length };
      }
      case 'assign': {
        assertCan(user, 'orders.assign');
        const updated = await tx.update(orders).set({ assignedToId: action.userId, updatedAt: now }).where(inArray(orders.id, ids)).returning({ id: orders.id });
        await logEvents(tx, updated.map((r) => ({ orderId: r.id, type: 'assigned', actorId: user.id, data: { userId: action.userId } }) satisfies EventInput));
        return { affected: updated.length };
      }
      case 'delete': {
        assertCan(user, 'orders.delete');
        const updated = await tx.update(orders).set({ deletedAt: now }).where(and(inArray(orders.id, ids), isNull(orders.deletedAt))).returning({ id: orders.id });
        await logEvents(tx, updated.map((r) => ({ orderId: r.id, type: 'deleted', actorId: user.id }) satisfies EventInput));
        return { affected: updated.length };
      }
      case 'restore': {
        assertCan(user, 'orders.delete');
        const updated = await tx.update(orders).set({ deletedAt: null }).where(and(inArray(orders.id, ids), isNotNull(orders.deletedAt))).returning({ id: orders.id });
        await logEvents(tx, updated.map((r) => ({ orderId: r.id, type: 'restored', actorId: user.id }) satisfies EventInput));
        return { affected: updated.length };
      }
      case 'purge': {
        // Permanent removal — only from the trash. The Lead ID goes with it, so the
        // order could be re-imported from the sheet afterwards.
        assertCan(user, 'orders.purge');
        const removed = await tx.delete(orders).where(and(inArray(orders.id, ids), isNotNull(orders.deletedAt))).returning({ id: orders.id });
        return { affected: removed.length };
      }
    }
  });
}

/** Neighbour ids for "next order" navigation in the detail panel. */
export async function oldestNewOrderId(db: Db) {
  const [row] = await db.select({ id: orders.id }).from(orders).where(and(eq(orders.status, 'new'), isNull(orders.deletedAt))).orderBy(asc(orders.createdAt)).limit(1);
  return row?.id ?? null;
}

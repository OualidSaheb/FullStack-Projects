import { and, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import {
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
import { formatReference, type AppContext } from '../../context';
import type { Db, DbOrTx } from '../../db/client';
import { carriers, customers, offers, orderComments, orderEvents, orders, users, variants } from '../../db/schema';
import { assertCan, type SessionUser } from '../../lib/auth';
import type { DomainEvents } from '../../lib/events';
import { badRequest, forbidden, notFound } from '../../lib/errors';
import { opt, reservedByVariant } from '../catalog/service';
import { deliveryFee } from '../carriers/service';
import { toHistory, upsertCustomer } from '../customers/service';
import { getSettings } from '../settings/service';
import { logEvents, type EventInput } from './events';
import { draftOfferItems, itemsLabel, loadItems, replaceItems } from './items';
import { selectOrdersWithRelations, toListItem } from './query';
import { transitionStatus, type TransitionContext } from './transitions';

type OrderRow = typeof orders.$inferSelect;
export type StatusEvent = DomainEvents['order.status_changed'];

export async function loadOrder(db: DbOrTx, id: string): Promise<OrderRow> {
  const [order] = await db.select().from(orders).where(eq(orders.id, id));
  if (!order) throw notFound('الطلبية غير موجودة');
  return order;
}

export async function transitionContext(ctx: AppContext, db: DbOrTx, user: SessionUser | null): Promise<TransitionContext> {
  return { db, actor: user, policy: (await getSettings(db)).callPolicy, prefix: ctx.config.ORDER_PREFIX };
}

export function emitStatusEvents(ctx: AppContext, events: (StatusEvent | null)[]) {
  const real = events.filter((e): e is StatusEvent => e !== null);
  if (real.length) ctx.events.emit('order.status_changed', real);
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
    stopdeskId: orders.stopdeskId,
    carrierTracking: orders.carrierTracking,
    carrierStatus: orders.carrierStatus,
    raw: orders.raw,
    sheetName: orders.sheetName,
    sheetRow: orders.sheetRow,
    customerId: orders.customerId,
    blacklistReason: customers.blacklistReason,
  }).where(eq(orders.id, id));
  if (!row) throw notFound('الطلبية غير موجودة');

  const { leadId, phoneCustomer, phoneFacebook, phoneAlt, wilayaRaw, address, offerRaw, stopdeskId, carrierTracking, carrierStatus, raw, sheetName, sheetRow, customerId, blacklistReason, ...list } = row;
  const base = toListItem(list, ctx.config.ORDER_PREFIX);

  const [items, fee, carrier, duplicate] = await Promise.all([
    loadItems(ctx.db, [id]),
    deliveryFee(ctx.db, list.carrierId, list.wilayaCode, list.deliveryType),
    list.carrierId ? ctx.db.select({ name: carriers.name }).from(carriers).where(eq(carriers.id, list.carrierId)).then((r) => r[0]) : undefined,
    list.duplicateOfId ? ctx.db.select({ id: orders.id, number: orders.number, status: orders.status }).from(orders).where(eq(orders.id, list.duplicateOfId)).then((r) => r[0]) : undefined,
  ]);
  const variantIds = items.flatMap((i) => (i.variantId ? [i.variantId] : []));
  const [reserved, stockRows] = await Promise.all([
    reservedByVariant(ctx.db, variantIds),
    variantIds.length ? ctx.db.select({ id: variants.id, stock: variants.stock }).from(variants).where(inArray(variants.id, variantIds)) : [],
  ]);
  const detailItems = items.map((i) => {
    const stock = stockRows.find((v) => v.id === i.variantId)?.stock;
    return { ...i, size: opt(i.size), color: opt(i.color), available: stock === undefined ? null : stock - (reserved.get(i.variantId!) ?? 0) };
  });
  if (detailItems.some((i) => i.available !== null && i.available < 0) && !base.flags.includes('stock')) base.flags.push('stock');

  return {
    ...base,
    leadId, phoneCustomer, phoneFacebook, phoneAlt, wilayaRaw, address, offerRaw, stopdeskId, carrierTracking, carrierStatus, raw, sheetName, sheetRow,
    carrierName: carrier?.name ?? null,
    deliveryFee: fee,
    items: detailItems,
    customer: customerId
      ? { id: customerId, blacklistReason, ...toHistory(list, Boolean(list.blacklisted)) }
      : null,
    duplicateOf: duplicate ? { id: duplicate.id, reference: formatReference(ctx.config.ORDER_PREFIX, duplicate.number), status: duplicate.status } : null,
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

function assertStatusAllowed(user: SessionUser, status: OrderStatus) {
  assertCan(user, 'orders.status');
  if (!STATUS_META[status].manual && !can(user.role, 'orders.status.any')) throw forbidden('هذه الحالة تُحدد تلقائياً من التوصيل');
}

async function insertComment(tx: DbOrTx, orderId: string, body: string, user: SessionUser) {
  await tx.insert(orderComments).values({ orderId, authorId: user.id, body });
  await tx.update(orders).set({ commentCount: sql`${orders.commentCount} + 1`, lastComment: body }).where(eq(orders.id, orderId));
  await logEvents(tx, { orderId, type: 'commented', actorId: user.id, data: { body } });
}

export async function changeStatus(ctx: AppContext, id: string, input: StatusChange, user: SessionUser) {
  assertStatusAllowed(user, input.status);
  const event = await ctx.db.transaction(async (tx) => {
    const order = await loadOrder(tx, id);
    if (order.deletedAt) throw badRequest('الطلبية محذوفة');
    const e = await transitionStatus(await transitionContext(ctx, tx, user), order, input.status, {
      callAt: input.callAt ? new Date(input.callAt) : undefined,
      cancelReason: input.cancelReason,
    });
    if (input.comment) await insertComment(tx, id, input.comment, user);
    return e;
  });
  emitStatusEvents(ctx, [event]);
  return getOrderDetail(ctx, id);
}

/** A returned parcel arrived back: put the pieces back in stock (or write them off). */
export async function receiveReturn(ctx: AppContext, id: string, condition: 'restock' | 'damaged', note: string | undefined, user: SessionUser) {
  const event = await ctx.db.transaction(async (tx) => {
    const order = await loadOrder(tx, id);
    if (order.status !== 'returned') throw badRequest('الطلبية ليست في حالة «مرتجعة»');
    const e = await transitionStatus(await transitionContext(ctx, tx, user), order, 'return_received', { returnCondition: condition });
    if (note) await insertComment(tx, id, note, user);
    return e;
  });
  emitStatusEvents(ctx, [event]);
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
  'customerName', 'phone', 'phoneAlt', 'wilayaCode', 'communeName', 'address', 'offerId', 'price', 'deliveryType', 'stopdeskId', 'carrierId',
] as const;

export async function updateOrder(ctx: AppContext, id: string, input: OrderUpdate, user: SessionUser) {
  assertCan(user, 'orders.edit');
  await ctx.db.transaction(async (tx) => {
    const order = await loadOrder(tx, id);
    const { reason, items, ...fields } = input;
    const next: Partial<OrderRow> = { ...fields };

    if (fields.phone !== undefined) {
      const phone = normalizePhone(fields.phone);
      next.phone = phone.value || null;
      next.phoneIssue = phone.valid ? null : 'invalid';
      next.customerId = await upsertCustomer(tx, next.phone, fields.customerName ?? order.customerName);
    }
    if (fields.phoneAlt) next.phoneAlt = normalizePhone(fields.phoneAlt).value || null;
    if (fields.wilayaCode && !getWilaya(fields.wilayaCode)) throw badRequest('ولاية غير معروفة');

    // A new offer re-prices from the offer list (unless a price is given) and re-drafts the pieces.
    const offerChanged = fields.offerId !== undefined && fields.offerId !== order.offerId;
    if (offerChanged && fields.offerId && fields.price === undefined) {
      const [offer] = await tx.select({ price: offers.price }).from(offers).where(eq(offers.id, fields.offerId));
      if (offer) next.price = offer.price;
    }

    const changes: Record<string, [unknown, unknown]> = {};
    for (const key of TRACKED_FIELDS) if (key in next && next[key] !== order[key]) changes[key] = [order[key], next[key]];

    const newItems = items ?? (offerChanged ? await draftOfferItems(tx, fields.offerId ?? null, order) : undefined);
    if (newItems) {
      if (order.stockOut) throw badRequest('لا يمكن تغيير القطع بعد خروجها من المخزن');
      const before = itemsLabel(await loadItems(tx, [id]));
      await replaceItems(tx, id, newItems);
      const after = itemsLabel(await loadItems(tx, [id]));
      if (before !== after) changes.items = [before, after];
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
  const statusEvents: (StatusEvent | null)[] = [];
  const result = await ctx.db.transaction(async (tx) => {
    switch (action.action) {
      case 'status': {
        assertStatusAllowed(user, action.status);
        const rows = await tx.select().from(orders).where(and(inArray(orders.id, ids), isNull(orders.deletedAt)));
        const t = await transitionContext(ctx, tx, user);
        for (const r of rows) statusEvents.push(await transitionStatus(t, r, action.status, { cancelReason: action.cancelReason, meta: { bulk: true } }));
        return { affected: statusEvents.filter(Boolean).length };
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
        // Permanent removal, only from the trash and only for pieces still in the warehouse.
        assertCan(user, 'orders.purge');
        const removed = await tx
          .delete(orders)
          .where(and(inArray(orders.id, ids), isNotNull(orders.deletedAt), eq(orders.stockOut, false)))
          .returning({ id: orders.id });
        return { affected: removed.length };
      }
    }
  });
  emitStatusEvents(ctx, statusEvents);
  return result;
}

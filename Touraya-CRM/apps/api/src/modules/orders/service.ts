import { and, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import {
  can,
  combinationLabel,
  combineOffers,
  getWilaya,
  normalizePhone,
  STATUS_META,
  type BulkAction,
  type OrderDetail,
  type OrderStatus,
  type OrderUpdate,
  type ReturnReceive,
  type StatusChange,
} from '@touraya/shared';
import { formatReference, parseReference, type AppContext } from '../../context';
import type { Db, DbOrTx } from '../../db/client';
import { carriers, customers, offers, orderComments, orderEvents, orders, purgedLeads, users, variants } from '../../db/schema';
import { assertCan, type SessionUser } from '../../lib/auth';
import type { DomainEvents } from '../../lib/events';
import { badRequest, forbidden, notFound } from '../../lib/errors';
import { opt, productTiers, reservedByVariant } from '../catalog/service';
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
    relatedOrderId: orders.relatedOrderId,
  }).where(eq(orders.id, id));
  if (!row) throw notFound('الطلبية غير موجودة');

  const { leadId, phoneCustomer, phoneFacebook, phoneAlt, address, offerRaw, stopdeskId, carrierTracking, carrierStatus, raw, sheetName, sheetRow, customerId, blacklistReason, relatedOrderId, ...list } = row;
  const base = toListItem(list, ctx.config.ORDER_PREFIX);

  // Every lookup that only needs the order runs together, then everything that needs its pieces:
  // two round trips to the database instead of one per lookup.
  const one = (id: string | null) =>
    id ? ctx.db.select({ id: orders.id, number: orders.number, status: orders.status }).from(orders).where(eq(orders.id, id)).then((r) => r[0]) : undefined;
  const [items, fee, carrier, duplicate, relatedRow] = await Promise.all([
    loadItems(ctx.db, [id]),
    deliveryFee(ctx.db, list.carrierId, list.wilayaCode, list.deliveryType),
    list.carrierId ? ctx.db.select({ name: carriers.name }).from(carriers).where(eq(carriers.id, list.carrierId)).then((r) => r[0]) : undefined,
    one(list.duplicateOfId),
    one(relatedOrderId),
  ]);
  const ref = (o?: { id: string; number: number; status: OrderStatus }) => (o ? { id: o.id, reference: formatReference(ctx.config.ORDER_PREFIX, o.number), status: o.status } : null);
  const units = items.reduce((n, i) => n + i.quantity, 0);
  const variantIds = items.flatMap((i) => (i.variantId ? [i.variantId] : []));
  const [tiers, reserved, stockRows] = await Promise.all([
    items[0] ? productTiers(ctx.db, items[0].productId) : [],
    variantIds.length ? reservedByVariant(ctx.db, variantIds) : new Map<number, number>(),
    variantIds.length ? ctx.db.select({ id: variants.id, stock: variants.stock }).from(variants).where(inArray(variants.id, variantIds)) : [],
  ]);
  const combo = combineOffers(tiers, units);
  const detailItems = items.map((i) => {
    const stock = stockRows.find((v) => v.id === i.variantId)?.stock;
    return { ...i, size: opt(i.size), color: opt(i.color), available: stock === undefined ? null : stock - (reserved.get(i.variantId!) ?? 0) };
  });
  if (detailItems.some((i) => i.available !== null && i.available < 0) && !base.flags.includes('stock')) base.flags.push('stock');

  return {
    ...base,
    leadId, phoneCustomer, phoneFacebook, phoneAlt, address, offerRaw, stopdeskId, carrierTracking, carrierStatus, raw, sheetName, sheetRow,
    carrierName: carrier?.name ?? null,
    deliveryFee: fee,
    items: detailItems,
    customer: customerId
      ? { id: customerId, blacklistReason, ...toHistory(list, Boolean(list.blacklisted)) }
      : null,
    duplicateOf: ref(duplicate),
    related: ref(relatedRow),
    suggestedPrice: combo ? { price: combo.price, label: combinationLabel(combo) } : null,
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
  // Whoever handles returns can register one by hand (no carrier webhook, parcel brought back…).
  if (status === 'returned' && can(user.role, 'returns.manage')) return;
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

/**
 * A returned parcel arrived back: each piece goes back on the shelf, is written
 * off as damaged, or never came back (kept / lost). Optionally the pieces were
 * re-sent to another order, which is then linked to this one.
 */
export async function receiveReturn(ctx: AppContext, id: string, input: ReturnReceive, user: SessionUser) {
  const event = await ctx.db.transaction(async (tx) => {
    const order = await loadOrder(tx, id);
    if (order.status !== 'returned') throw badRequest('الطلبية ليست في حالة «مرتجعة»');
    let linked: OrderRow | undefined;
    if (input.linkOrderReference) {
      const number = parseReference(input.linkOrderReference);
      [linked] = number ? await tx.select().from(orders).where(eq(orders.number, number)) : [];
      if (!linked || linked.id === id) throw badRequest('رقم الطلبية المرتبطة غير موجود');
    }
    const returnItems = input.items ? Object.fromEntries(input.items.map((i) => [i.itemId, i.condition])) : undefined;
    const e = await transitionStatus(await transitionContext(ctx, tx, user), order, 'return_received', {
      returnCondition: input.condition,
      returnItems,
      meta: linked ? { linkedOrder: formatReference(ctx.config.ORDER_PREFIX, linked.number) } : undefined,
    });
    if (linked) {
      await tx.update(orders).set({ relatedOrderId: linked.id }).where(eq(orders.id, id));
      await tx.update(orders).set({ relatedOrderId: id }).where(eq(orders.id, linked.id));
      await logEvents(tx, { orderId: linked.id, type: 'updated', actorId: user.id, data: { changes: { related: [null, formatReference(ctx.config.ORDER_PREFIX, order.number)] }, via: 'return' } });
    }
    if (input.note) await insertComment(tx, id, input.note, user);
    return e;
  });
  emitStatusEvents(ctx, [event]);
  return getOrderDetail(ctx, id);
}

/** A new order for the same customer from an existing one (refused parcel re-sent, customer orders again). */
export async function reorder(ctx: AppContext, id: string, status: 'new' | 'confirmed', user: SessionUser) {
  assertStatusAllowed(user, status);
  const newId = await ctx.db.transaction(async (tx) => {
    const o = await loadOrder(tx, id);
    const [created] = await tx
      .insert(orders)
      .values({
        sourceId: o.sourceId,
        formId: o.formId,
        adName: o.adName,
        customerId: o.customerId,
        customerName: o.customerName,
        phone: o.phone,
        phoneCustomer: o.phoneCustomer,
        phoneFacebook: o.phoneFacebook,
        phoneAlt: o.phoneAlt,
        phoneIssue: o.phoneIssue,
        wilayaCode: o.wilayaCode,
        wilayaRaw: o.wilayaRaw,
        communeName: o.communeName,
        communeRaw: o.communeRaw,
        address: o.address,
        deliveryType: o.deliveryType,
        stopdeskId: o.stopdeskId,
        offerId: o.offerId,
        offerRaw: o.offerRaw,
        price: o.price,
        size: o.size,
        colors: o.colors,
        carrierId: o.carrierId,
        assignedToId: user.role === 'agent' ? user.id : o.assignedToId,
        relatedOrderId: o.id,
        raw: { ...o.raw, _reorderOf: formatReference(ctx.config.ORDER_PREFIX, o.number) },
      })
      .returning();
    const items = await loadItems(tx, [id]);
    await replaceItems(tx, created!.id, items.map((i) => ({ productId: i.productId, size: opt(i.size), color: opt(i.color), quantity: i.quantity })));
    await tx.update(orders).set({ relatedOrderId: created!.id }).where(eq(orders.id, id));
    await logEvents(tx, [
      { orderId: created!.id, type: 'created', actorId: user.id, data: { source: `إعادة طلب ${formatReference(ctx.config.ORDER_PREFIX, o.number)}` } },
      { orderId: id, type: 'updated', actorId: user.id, data: { changes: { related: [null, formatReference(ctx.config.ORDER_PREFIX, created!.number)] }, via: 'reorder' } },
    ]);
    if (status === 'confirmed') await transitionStatus(await transitionContext(ctx, tx, user), created!, 'confirmed');
    return created!.id;
  });
  ctx.events.emit('order.created', { orderId: newId, sourceId: null });
  return getOrderDetail(ctx, newId);
}

/** Re-fills the pieces from the customer's answers (after adding the colors/sizes they asked for). */
export async function redraftItems(ctx: AppContext, id: string, user: SessionUser) {
  const order = await loadOrder(ctx.db, id);
  const units = (await loadItems(ctx.db, [id])).reduce((n, i) => n + i.quantity, 0);
  const items = await draftOfferItems(ctx.db, order.offerId, order, units || undefined);
  return updateOrder(ctx, id, { items }, user);
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
    const newItems = items ?? (offerChanged ? await draftOfferItems(tx, fields.offerId ?? null, order) : undefined);
    if (newItems) {
      if (order.stockOut) throw badRequest('لا يمكن تغيير القطع بعد خروجها من المخزن');
      const [before, tiers] = await Promise.all([loadItems(tx, [id]), newItems[0] ? productTiers(tx, newItems[0].productId) : []]);
      await replaceItems(tx, id, newItems);
      const after = itemsLabel(newItems.map((i) => ({ size: i.size ?? '', color: i.color ?? '', quantity: i.quantity })));
      if (itemsLabel(before) !== after) changes.items = [itemsLabel(before), after];
      // Number of pieces changed by hand: price (and offer) follow the product's tiers
      // — 1 = 2100, 2 = 3500, 3 = 4999… — unless a price or an offer was set explicitly.
      const units = (rows: { quantity: number }[]) => rows.reduce((n, r) => n + r.quantity, 0);
      const productIds = new Set(newItems.map((i) => i.productId));
      if (items && fields.price === undefined && fields.offerId === undefined && productIds.size === 1 && units(newItems) !== units(before)) {
        const combo = combineOffers(tiers, units(newItems));
        if (combo) {
          next.price = combo.price;
          next.offerId = combo.exactOfferId ?? combo.mainOfferId;
        }
      }
    }
    for (const key of TRACKED_FIELDS) if (key in next && next[key] !== order[key]) changes[key] = [order[key], next[key]];
    if (!Object.keys(changes).length) return;

    await tx.update(orders).set({ ...next, updatedAt: new Date() }).where(eq(orders.id, id));
    await logEvents(tx, { orderId: id, type: 'updated', actorId: user.id, data: { changes } });
    if (reason) await insertComment(tx, id, reason, user);
  });
  return getOrderDetail(ctx, id);
}

export async function bulkAction(ctx: AppContext, action: BulkAction, user: SessionUser) {
  const { ids } = action;
  if (action.action === 'offer') {
    // One transaction per order (same path as a manual edit); shipped orders are left untouched.
    assertCan(user, 'orders.edit');
    let affected = 0;
    for (const id of ids) {
      const order = await loadOrder(ctx.db, id);
      if (order.stockOut || order.deletedAt || order.offerId === action.offerId) continue;
      await updateOrder(ctx, id, { offerId: action.offerId }, user);
      affected++;
    }
    return { affected };
  }
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
          .returning({ id: orders.id, leadId: orders.leadId });
        const leads = removed.flatMap((r) => (r.leadId ? [{ leadId: r.leadId }] : []));
        if (leads.length) await tx.insert(purgedLeads).values(leads).onConflictDoNothing();
        return { affected: removed.length };
      }
    }
  });
  emitStatusEvents(ctx, statusEvents);
  return result;
}

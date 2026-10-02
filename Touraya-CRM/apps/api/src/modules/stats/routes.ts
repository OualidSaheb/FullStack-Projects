import type { FastifyPluginAsync } from 'fastify';
import { eq, inArray, isNotNull, sql, type SQL } from 'drizzle-orm';
import { BLOCKING_PHONE_ISSUES, orderFilterSchema, type OrderStatus, type StatsDTO } from '@touraya/shared';
import { offers, orderItems, orders, products, sources, users } from '../../db/schema';
import { buildOrderWhere } from '../orders/query';

const CONFIRMED_OR_LATER: OrderStatus[] = ['confirmed', 'ready_for_carrier', 'sent_to_carrier', 'carrier_received', 'delivered', 'returned', 'return_received'];
const SHIPPED: OrderStatus[] = ['ready_for_carrier', 'sent_to_carrier', 'carrier_received', 'delivered', 'returned', 'return_received'];
const RETURNED: OrderStatus[] = ['returned', 'return_received'];

const count = sql<number>`count(*)::int`;
const countWhere = (cond: SQL) => sql<number>`count(*) filter (where ${cond})::int`;
const sumWhere = (cond: SQL) => sql<number>`coalesce(sum(${orders.price}) filter (where ${cond}), 0)::int`;
const rate = (part: number, whole: number) => (whole ? Math.round((part / whole) * 1000) / 10 : 0);

export const statsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/stats', { preHandler: app.requirePermission('stats.view') }, async (req): Promise<StatsDTO> => {
    const filter = orderFilterSchema.parse(req.query);
    const where = buildOrderWhere({ ...filter, deleted: false }, req.user);
    const confirmed = countWhere(inArray(orders.status, CONFIRMED_OR_LATER));
    const cancelled = countWhere(sql`${orders.status} = 'cancelled'`);
    const delivered = countWhere(sql`${orders.status} = 'delivered'`);
    const returned = countWhere(inArray(orders.status, RETURNED));
    // Algeria is UTC+1 with no DST.
    const day = sql<string>`to_char((${orders.createdAt} at time zone 'UTC') + interval '1 hour', 'YYYY-MM-DD')`;

    const returnedPieces = app.db
      .select({
        condition: orderItems.returnCondition,
        pieces: sql<number>`coalesce(sum(${orderItems.quantity}), 0)::int`,
        cost: sql<number>`coalesce(sum(${orderItems.quantity} * ${products.costPrice}), 0)::int`,
      })
      .from(orderItems)
      .innerJoin(orders, eq(orders.id, orderItems.orderId))
      .innerJoin(products, eq(products.id, orderItems.productId))
      .where(sql`${where} and ${isNotNull(orderItems.returnCondition)}`)
      .groupBy(orderItems.returnCondition);
    const topReturned = app.db
      .select({
        label: sql<string>`trim(concat_ws(' ', ${products.name}, nullif(${orderItems.size}, ''), nullif(${orderItems.color}, '')))`,
        count: sql<number>`sum(${orderItems.quantity})::int`,
      })
      .from(orderItems)
      .innerJoin(orders, eq(orders.id, orderItems.orderId))
      .innerJoin(products, eq(products.id, orderItems.productId))
      .where(sql`${where} and ${inArray(orders.status, RETURNED)}`)
      .groupBy(products.name, orderItems.size, orderItems.color)
      .orderBy(sql`sum(${orderItems.quantity}) desc`)
      .limit(8);

    const [totals, byStatus, byOffer, byWilaya, bySource, byAgent, cancelReasons, daily, pieces, topVariants] = await Promise.all([
      app.db
        .select({
          all: count,
          confirmed,
          cancelled,
          delivered,
          returned,
          shipped: countWhere(inArray(orders.status, SHIPPED)),
          phoneIssues: countWhere(inArray(orders.phoneIssue, BLOCKING_PHONE_ISSUES)),
          revenueConfirmed: sumWhere(inArray(orders.status, CONFIRMED_OR_LATER)),
          revenueDelivered: sumWhere(sql`${orders.status} = 'delivered'`),
        })
        .from(orders)
        .where(where),
      app.db.select({ status: orders.status, count }).from(orders).where(where).groupBy(orders.status),
      app.db
        .select({ offerId: orders.offerId, name: sql<string>`coalesce(${offers.name}, 'بدون عرض')`, count, confirmed, delivered, returned })
        .from(orders)
        .leftJoin(offers, eq(offers.id, orders.offerId))
        .where(where)
        .groupBy(orders.offerId, offers.name)
        .orderBy(sql`count(*) desc`),
      app.db.select({ wilayaCode: orders.wilayaCode, count, delivered, returned }).from(orders).where(where).groupBy(orders.wilayaCode).orderBy(sql`count(*) desc`),
      app.db
        .select({ sourceId: orders.sourceId, name: sql<string>`coalesce(${sources.name}, 'يدوي')`, count })
        .from(orders)
        .leftJoin(sources, eq(sources.id, orders.sourceId))
        .where(where)
        .groupBy(orders.sourceId, sources.name)
        .orderBy(sql`count(*) desc`),
      app.db
        .select({ userId: orders.assignedToId, name: sql<string>`coalesce(${users.name}, 'غير مسندة')`, handled: count, confirmed, cancelled })
        .from(orders)
        .leftJoin(users, eq(users.id, orders.assignedToId))
        .where(where)
        .groupBy(orders.assignedToId, users.name)
        .orderBy(sql`count(*) desc`),
      app.db
        .select({ reason: sql<string>`${orders.cancelReason}`, count })
        .from(orders)
        .where(sql`${where} and ${isNotNull(orders.cancelReason)}`)
        .groupBy(orders.cancelReason)
        .orderBy(sql`count(*) desc`),
      app.db.select({ day, count, confirmed }).from(orders).where(where).groupBy(day).orderBy(day),
      returnedPieces,
      topReturned,
    ]);
    const piecesOf = (c: string) => pieces.find((p) => p.condition === c);

    const t = totals[0]!;
    return {
      totals: {
        all: t.all,
        confirmed: t.confirmed,
        cancelled: t.cancelled,
        shipped: t.shipped,
        delivered: t.delivered,
        returned: t.returned,
        phoneIssues: t.phoneIssues,
        revenueConfirmed: t.revenueConfirmed,
        revenueDelivered: t.revenueDelivered,
        confirmationRate: rate(t.confirmed, t.confirmed + t.cancelled),
        deliveryRate: rate(t.delivered, t.delivered + t.returned),
      },
      byStatus,
      byOffer,
      byWilaya,
      bySource,
      byAgent: byAgent.map((a) => ({ ...a, rate: rate(a.confirmed, a.confirmed + a.cancelled) })),
      cancelReasons,
      daily,
      returns: {
        inTransit: byStatus.find((s) => s.status === 'returned')?.count ?? 0,
        received: byStatus.find((s) => s.status === 'return_received')?.count ?? 0,
        restocked: piecesOf('restock')?.pieces ?? 0,
        damaged: piecesOf('damaged')?.pieces ?? 0,
        kept: piecesOf('kept')?.pieces ?? 0,
        lossCost: (piecesOf('damaged')?.cost ?? 0) + (piecesOf('kept')?.cost ?? 0),
        topVariants,
      },
    };
  });
};

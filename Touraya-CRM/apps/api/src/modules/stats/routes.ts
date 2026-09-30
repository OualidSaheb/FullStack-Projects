import type { FastifyPluginAsync } from 'fastify';
import { eq, inArray, sql } from 'drizzle-orm';
import { BLOCKING_PHONE_ISSUES, orderFilterSchema, type OrderStatus, type StatsDTO } from '@touraya/shared';
import { orders, products, sources, users } from '../../db/schema';
import { buildOrderWhere } from '../orders/query';

const CONFIRMED_OR_LATER: OrderStatus[] = ['confirmed', 'ready_for_carrier', 'sent_to_carrier', 'carrier_received', 'delivered', 'returned'];
const SHIPPED: OrderStatus[] = ['ready_for_carrier', 'sent_to_carrier', 'carrier_received', 'delivered', 'returned'];

const count = sql<number>`count(*)::int`;
const countWhere = (cond: ReturnType<typeof sql> | ReturnType<typeof inArray>) => sql<number>`count(*) filter (where ${cond})::int`;
const rate = (part: number, whole: number) => (whole ? Math.round((part / whole) * 1000) / 10 : 0);

export const statsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/stats', { preHandler: app.requirePermission('stats.view') }, async (req): Promise<StatsDTO> => {
    const filter = orderFilterSchema.parse(req.query);
    const where = buildOrderWhere({ ...filter, deleted: false }, req.user);
    const confirmed = countWhere(inArray(orders.status, CONFIRMED_OR_LATER));
    const cancelled = countWhere(sql`${orders.status} = 'cancelled'`);
    // Algeria is UTC+1 with no DST.
    const day = sql<string>`to_char((${orders.createdAt} at time zone 'UTC') + interval '1 hour', 'YYYY-MM-DD')`;

    const [totals, byStatus, byProduct, byWilaya, bySource, byAgent, daily] = await Promise.all([
      app.db
        .select({
          all: count,
          confirmed,
          cancelled,
          shipped: countWhere(inArray(orders.status, SHIPPED)),
          delivered: countWhere(sql`${orders.status} = 'delivered'`),
          returned: countWhere(sql`${orders.status} = 'returned'`),
          phoneIssues: countWhere(inArray(orders.phoneIssue, BLOCKING_PHONE_ISSUES)),
          revenueConfirmed: sql<number>`coalesce(sum(${orders.price}) filter (where ${inArray(orders.status, CONFIRMED_OR_LATER)}), 0)::int`,
        })
        .from(orders)
        .where(where),
      app.db.select({ status: orders.status, count }).from(orders).where(where).groupBy(orders.status),
      app.db
        .select({ productId: orders.productId, name: sql<string>`coalesce(${products.name}, 'بدون منتج')`, count, confirmed })
        .from(orders)
        .leftJoin(products, eq(products.id, orders.productId))
        .where(where)
        .groupBy(orders.productId, products.name)
        .orderBy(sql`count(*) desc`),
      app.db.select({ wilayaCode: orders.wilayaCode, count }).from(orders).where(where).groupBy(orders.wilayaCode).orderBy(sql`count(*) desc`),
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
      app.db.select({ day, count, confirmed }).from(orders).where(where).groupBy(day).orderBy(day),
    ]);

    const t = totals[0]!;
    const decided = t.confirmed + t.cancelled;
    return {
      totals: {
        all: t.all,
        confirmed: t.confirmed,
        cancelled: t.cancelled,
        shipped: t.shipped,
        delivered: t.delivered,
        phoneIssues: t.phoneIssues,
        revenueConfirmed: t.revenueConfirmed,
        confirmationRate: rate(t.confirmed, decided),
        deliveryRate: rate(t.delivered, t.delivered + t.returned),
      },
      byStatus,
      byProduct,
      byWilaya,
      bySource,
      byAgent: byAgent.map((a) => ({ ...a, rate: rate(a.confirmed, a.confirmed + a.cancelled) })),
      daily,
    };
  });
};

import { and, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { IN_TRANSIT_STATUSES, PARCEL_LOCKED_STATUSES, type OrderStatus, type ParcelGroupStats, type ShippingStatsDTO } from '@touraya/shared';
import { endOfDay, startOfDay, type AppContext } from '../../context';
import { offers, orderEvents, orders, users } from '../../db/schema';

const RETURNED: OrderStatus[] = ['returned', 'return_received'];
const IN_PROGRESS: OrderStatus[] = ['ready_for_carrier', ...IN_TRANSIT_STATUSES];

const count = sql<number>`count(*)::int`;
const countWhere = (cond: SQL) => sql<number>`count(*) filter (where ${cond})::int`;
const sumWhere = (cond: SQL) => sql<number>`coalesce(sum(${orders.price}) filter (where ${cond}), 0)::int`;
const rate = (part: number, whole: number) => (whole ? Math.round((part / whole) * 1000) / 10 : 0);
const delivered = countWhere(sql`${orders.status} = 'delivered'`);
const returned = countWhere(inArray(orders.status, RETURNED));
const withRate = <T extends { count: number; delivered: number; returned: number }>(r: T): T & ParcelGroupStats => ({ ...r, rate: rate(r.delivered, r.delivered + r.returned) });

/** The day a parcel counts for: its confirmation (linked parcels: the day the carrier got it). */
const sentAt = sql`coalesce(${orders.confirmedAt}, ${orders.createdAt})`;

/**
 * Statistics of the parcels only: what the delivery company has or had, how
 * much of it arrives, comes back, brings money, where and why it fails.
 * The CRM statistics (all orders) stay separate.
 */
export async function shippingStats(ctx: AppContext, filter: { from?: string; to?: string; carrierId?: number }): Promise<ShippingStatsDTO> {
  const conds: SQL[] = [isNull(orders.deletedAt), inArray(orders.status, PARCEL_LOCKED_STATUSES)];
  // As text: a Date inside raw SQL is not serialised by every driver (postgres-js).
  if (filter.from) conds.push(sql`${sentAt} >= ${startOfDay(filter.from).toISOString()}::timestamptz`);
  if (filter.to) conds.push(sql`${sentAt} < ${endOfDay(filter.to).toISOString()}::timestamptz`);
  if (filter.carrierId) conds.push(eq(orders.carrierId, filter.carrierId));
  const where = and(...conds)!;
  const day = sql<string>`to_char((${sentAt} at time zone 'UTC') + interval '1 hour', 'YYYY-MM-DD')`;
  const inScope = sql`${orderEvents.orderId} in (select ${orders.id} from ${orders} where ${where})`;

  const [totals, byStatus, byWilaya, byOffer, byAgent, byDeliveryType, daily, failReasons, payments, speed] = await Promise.all([
    ctx.db
      .select({
        parcels: count,
        inProgress: countWhere(inArray(orders.status, IN_PROGRESS)),
        delivered,
        returned,
        failedNow: countWhere(sql`${orders.status} = 'delivery_failed'`),
        revenueDelivered: sumWhere(sql`${orders.status} = 'delivered'`),
        revenuePending: sumWhere(inArray(orders.status, IN_PROGRESS)),
        revenueReturned: sumWhere(inArray(orders.status, RETURNED)),
      })
      .from(orders)
      .where(where),
    ctx.db.select({ status: orders.status, count }).from(orders).where(where).groupBy(orders.status),
    ctx.db.select({ wilayaCode: orders.wilayaCode, count, delivered, returned }).from(orders).where(where).groupBy(orders.wilayaCode).orderBy(sql`count(*) desc`),
    ctx.db
      .select({ offerId: orders.offerId, name: sql<string>`coalesce(${offers.name}, 'بدون عرض')`, count, delivered, returned })
      .from(orders)
      .leftJoin(offers, eq(offers.id, orders.offerId))
      .where(where)
      .groupBy(orders.offerId, offers.name)
      .orderBy(sql`count(*) desc`),
    ctx.db
      .select({ userId: orders.confirmedById, name: sql<string>`coalesce(${users.name}, 'غير معروف')`, count, delivered, returned })
      .from(orders)
      .leftJoin(users, eq(users.id, orders.confirmedById))
      .where(where)
      .groupBy(orders.confirmedById, users.name)
      .orderBy(sql`count(*) desc`),
    ctx.db.select({ deliveryType: orders.deliveryType, count, delivered, returned }).from(orders).where(where).groupBy(orders.deliveryType),
    ctx.db.select({ day, count, delivered, returned }).from(orders).where(where).groupBy(day).orderBy(day),
    // Why deliveries fail (the carrier's words), each parcel's reasons counted once.
    ctx.db
      .select({ reason: sql<string>`${orderEvents.data}->>'reason'`, count: sql<number>`count(distinct ${orderEvents.orderId})::int` })
      .from(orderEvents)
      .where(and(eq(orderEvents.type, 'carrier_update'), sql`coalesce(${orderEvents.data}->>'reason', '') <> ''`, inScope))
      .groupBy(sql`${orderEvents.data}->>'reason'`)
      .orderBy(sql`count(distinct ${orderEvents.orderId}) desc`)
      .limit(10),
    // The carrier's latest payment news per parcel.
    ctx.db.execute<{ status: string; count: number; amount: number }>(sql`
      select p.payment as status, count(*)::int as count, coalesce(sum(o.price), 0)::int as amount
      from (
        select distinct on (${orderEvents.orderId}) ${orderEvents.orderId} as order_id, ${orderEvents.data}->>'payment' as payment
        from ${orderEvents}
        where ${orderEvents.type} = 'carrier_update' and ${orderEvents.data}->>'payment' is not null and ${inScope}
        order by ${orderEvents.orderId}, ${orderEvents.createdAt} desc
      ) p
      join ${orders} o on o.id = p.order_id
      group by p.payment`),
    // Followed live only: a parcel linked afterwards has no real delivery moment.
    ctx.db
      .select({ days: sql<number | null>`round(avg(extract(epoch from (${orderEvents.createdAt} - ${sentAt})) / 86400)::numeric, 1)::float` })
      .from(orderEvents)
      .innerJoin(orders, eq(orders.id, orderEvents.orderId))
      .where(and(where, eq(orderEvents.type, 'status_changed'), sql`${orderEvents.data}->>'to' = 'delivered'`, sql`coalesce(${orderEvents.data}->>'via', '') <> 'link'`)),
  ]);

  const t = totals[0]!;
  const rows = (r: unknown) => (Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? [])) as { status: string; count: number; amount: number }[];
  return {
    totals: {
      ...t,
      deliveryRate: rate(t.delivered, t.delivered + t.returned),
      returnRate: rate(t.returned, t.delivered + t.returned),
      avgDeliveryDays: speed[0]?.days ?? null,
    },
    byStatus,
    payments: rows(payments).map((p) => ({ status: p.status, count: Number(p.count), amount: Number(p.amount) })),
    byWilaya: byWilaya.map(withRate),
    byOffer: byOffer.map(withRate),
    byAgent: byAgent.map(withRate),
    byDeliveryType: byDeliveryType.map(withRate),
    failReasons,
    daily,
  };
}

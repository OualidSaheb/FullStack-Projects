import { and, eq, gte, isNull, ne, sql } from 'drizzle-orm';
import { isValidPhone, type CustomerHistory } from '@touraya/shared';
import type { DbOrTx } from '../../db/client';
import { customers, orders } from '../../db/schema';

/** One customer per valid phone number; returns its id (null for unusable numbers). */
export async function upsertCustomer(db: DbOrTx, phone: string | null, name: string): Promise<number | null> {
  if (!phone || !isValidPhone(phone)) return null;
  const [row] = await db
    .insert(customers)
    .values({ phone, name })
    .onConflictDoUpdate({ target: customers.phone, set: { name: sql`case when ${customers.name} = '' then excluded.name else ${customers.name} end` } })
    .returning({ id: customers.id });
  return row!.id;
}

/** SQL fragments counting a customer's other orders, reused by list rows and the detail view. */
export const historyColumns = (customerIdSql: ReturnType<typeof sql>, excludeOrderIdSql: ReturnType<typeof sql>) => ({
  histOrders: sql<number>`(select count(*)::int from orders o2 where o2.customer_id = ${customerIdSql} and o2.id <> ${excludeOrderIdSql} and o2.deleted_at is null)`,
  histDelivered: sql<number>`(select count(*)::int from orders o2 where o2.customer_id = ${customerIdSql} and o2.id <> ${excludeOrderIdSql} and o2.deleted_at is null and o2.status = 'delivered')`,
  histReturned: sql<number>`(select count(*)::int from orders o2 where o2.customer_id = ${customerIdSql} and o2.id <> ${excludeOrderIdSql} and o2.deleted_at is null and o2.status in ('returned', 'return_received'))`,
  histCancelled: sql<number>`(select count(*)::int from orders o2 where o2.customer_id = ${customerIdSql} and o2.id <> ${excludeOrderIdSql} and o2.deleted_at is null and o2.status = 'cancelled')`,
});

export function toHistory(r: { histOrders: number; histDelivered: number; histReturned: number; histCancelled: number }, blacklisted: boolean): CustomerHistory {
  return { orders: r.histOrders, delivered: r.histDelivered, returned: r.histReturned, cancelled: r.histCancelled, blacklisted };
}

/** An open order of the same customer within the window → "possible duplicate". */
export async function findRecentOpenOrder(db: DbOrTx, customerId: number, since: Date, excludeId?: string) {
  const [row] = await db
    .select({ id: orders.id })
    .from(orders)
    .where(
      and(
        eq(orders.customerId, customerId),
        isNull(orders.deletedAt),
        gte(orders.createdAt, since),
        sql`${orders.status} not in ('cancelled', 'delivered', 'returned', 'return_received')`,
        excludeId ? ne(orders.id, excludeId) : undefined,
      ),
    )
    .orderBy(orders.createdAt)
    .limit(1);
  return row?.id ?? null;
}

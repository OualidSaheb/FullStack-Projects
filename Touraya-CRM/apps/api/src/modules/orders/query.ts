import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import { alias, type SelectedFields } from 'drizzle-orm/pg-core';
import {
  BLOCKING_PHONE_ISSUES,
  customerRisk,
  QUEUE_STATUSES,
  type OrderFilter,
  type OrderFlag,
  type OrderListItem,
  type OrderListQuery,
  type OrderProblem,
} from '@touraya/shared';
import { endOfDay, formatReference, parseReference, startOfDay } from '../../context';
import type { DbOrTx } from '../../db/client';
import { customers, offers, orders, sources, users } from '../../db/schema';
import type { SessionUser } from '../../lib/auth';
import { historyColumns, toHistory } from '../customers/service';

// Correlated sub-queries reference the outer row explicitly ("orders"."id").
const missingVariants = sql<boolean>`exists (select 1 from order_items oi where oi.order_id = "orders"."id" and oi.variant_id is null)`;

const PROBLEM_SQL: Record<OrderProblem, SQL> = {
  phone: inArray(orders.phoneIssue, BLOCKING_PHONE_ISSUES),
  commune: isNull(orders.communeName),
  duplicate: isNotNull(orders.duplicateOfId),
  variants: missingVariants,
};
const anyProblem = or(...Object.values(PROBLEM_SQL))!;

/** Orders an agent may call now: in the queue, due, not locked by a colleague, unassigned or theirs. */
export function dueForUser(userId: number): SQL {
  return and(
    isNull(orders.deletedAt),
    inArray(orders.status, QUEUE_STATUSES),
    sql`(${orders.nextCallAt} is null or ${orders.nextCallAt} <= now())`,
    sql`(${orders.lockedUntil} is null or ${orders.lockedUntil} < now() or ${orders.lockedById} = ${userId})`,
    sql`(${orders.assignedToId} is null or ${orders.assignedToId} = ${userId})`,
  )!;
}

/** Translates the shared filter contract into SQL conditions. */
export function buildOrderWhere(filter: OrderFilter, user: SessionUser, opts: { ignoreStatus?: boolean } = {}): SQL | undefined {
  const conds: (SQL | undefined)[] = [filter.deleted ? isNotNull(orders.deletedAt) : isNull(orders.deletedAt)];

  if (filter.status?.length && !opts.ignoreStatus) conds.push(inArray(orders.status, filter.status));
  if (filter.offerId) conds.push(eq(orders.offerId, filter.offerId));
  if (filter.productId) conds.push(sql`exists (select 1 from order_items oi where oi.order_id = "orders"."id" and oi.product_id = ${filter.productId})`);
  if (filter.sourceId) conds.push(eq(orders.sourceId, filter.sourceId));
  if (filter.carrierId) conds.push(eq(orders.carrierId, filter.carrierId));
  if (filter.wilayaCode) conds.push(eq(orders.wilayaCode, filter.wilayaCode));
  if (filter.assignedTo === 'me') conds.push(eq(orders.assignedToId, user.id));
  else if (filter.assignedTo === 'none') conds.push(isNull(orders.assignedToId));
  else if (typeof filter.assignedTo === 'number') conds.push(eq(orders.assignedToId, filter.assignedTo));
  if (filter.problem) conds.push(PROBLEM_SQL[filter.problem]);
  if (filter.from) conds.push(gte(orders.createdAt, startOfDay(filter.from)));
  if (filter.to) conds.push(lt(orders.createdAt, endOfDay(filter.to)));

  const q = filter.q?.trim();
  if (q) {
    const like = `%${q}%`;
    const digits = q.replace(/\D/g, '').replace(/^0/, '');
    const number = parseReference(q);
    conds.push(
      or(
        ilike(orders.customerName, like),
        ilike(orders.communeName, like),
        ilike(orders.communeRaw, like),
        ilike(orders.leadId, like),
        ilike(orders.colors, like),
        ilike(orders.offerRaw, like),
        ilike(orders.carrierTracking, like),
        digits.length >= 4 ? ilike(orders.phone, `%${digits}%`) : undefined,
        digits.length >= 4 ? ilike(orders.phoneFacebook, `%${digits}%`) : undefined,
        number ? eq(orders.number, number) : undefined,
      ),
    );
  }
  return and(...conds);
}

const assignee = alias(users, 'assignee');

const sortColumns = {
  createdAt: orders.createdAt,
  updatedAt: orders.updatedAt,
  nextCallAt: orders.nextCallAt,
  price: orders.price,
  status: orders.status,
  wilayaCode: orders.wilayaCode,
  customerName: orders.customerName,
} as const;

/** Columns selected for list rows — reused by the detail query. */
export const listSelection = {
  id: orders.id,
  number: orders.number,
  status: orders.status,
  customerName: orders.customerName,
  phone: orders.phone,
  phoneIssue: orders.phoneIssue,
  wilayaCode: orders.wilayaCode,
  communeName: orders.communeName,
  communeRaw: orders.communeRaw,
  wilayaRaw: orders.wilayaRaw,
  offerId: orders.offerId,
  offerName: offers.name,
  price: orders.price,
  size: orders.size,
  colors: orders.colors,
  deliveryType: orders.deliveryType,
  carrierId: orders.carrierId,
  sourceId: orders.sourceId,
  sourceName: sources.name,
  assignedToId: orders.assignedToId,
  assignedToName: assignee.name,
  callAttempts: orders.callAttempts,
  nextCallAt: orders.nextCallAt,
  cancelReason: orders.cancelReason,
  commentCount: orders.commentCount,
  lastComment: orders.lastComment,
  duplicateOfId: orders.duplicateOfId,
  blacklisted: customers.blacklisted,
  createdAt: orders.createdAt,
  updatedAt: orders.updatedAt,
  deletedAt: orders.deletedAt,
  itemsLabel: sql<string | null>`(select string_agg(nullif(trim(concat_ws(' ', nullif(oi.size, ''), nullif(oi.color, ''))), ''), ' + ' order by oi.id) from order_items oi where oi.order_id = "orders"."id")`,
  units: sql<number>`(select coalesce(sum(oi.quantity), 0)::int from order_items oi where oi.order_id = "orders"."id")`,
  missingVariants,
  ...historyColumns(sql`"orders"."customer_id"`, sql`"orders"."id"`),
};

export function selectOrdersWithRelations<T extends SelectedFields>(db: DbOrTx, extra: T = {} as T) {
  return db
    .select({ ...listSelection, ...extra })
    .from(orders)
    .leftJoin(offers, eq(offers.id, orders.offerId))
    .leftJoin(sources, eq(sources.id, orders.sourceId))
    .leftJoin(customers, eq(customers.id, orders.customerId))
    .leftJoin(assignee, eq(assignee.id, orders.assignedToId));
}

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
type ListRow = Awaited<ReturnType<typeof selectOrdersWithRelations<{}>>>[number];

export function toListItem(row: ListRow, prefix: string): OrderListItem {
  const { number, createdAt, updatedAt, deletedAt, nextCallAt, duplicateOfId, blacklisted, missingVariants: missing, histOrders, histDelivered, histReturned, histCancelled, histShipped, itemsLabel, ...rest } =
    row;
  const risk = customerRisk(toHistory({ histOrders, histDelivered, histReturned, histCancelled }, Boolean(blacklisted)));
  const flags: OrderFlag[] = [];
  if (rest.phoneIssue && BLOCKING_PHONE_ISSUES.includes(rest.phoneIssue)) flags.push('phone');
  if (!rest.communeName) flags.push('commune');
  if (duplicateOfId) flags.push('duplicate');
  if (missing) flags.push('variants');
  if (risk === 'blocked') flags.push('blacklisted');
  if (risk === 'risky') flags.push('risky');
  // Ordered before and a parcel was sent: a small heads-up (re-order, or the same order twice).
  if (histShipped > 0 && risk !== 'blocked' && risk !== 'risky') flags.push('repeat');
  return {
    ...rest,
    reference: formatReference(prefix, number),
    itemsLabel: itemsLabel ?? '',
    flags,
    risk,
    nextCallAt: nextCallAt?.toISOString() ?? null,
    createdAt: createdAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
    deletedAt: deletedAt?.toISOString() ?? null,
  };
}

export async function listOrders(db: DbOrTx, query: OrderListQuery, user: SessionUser, prefix: string) {
  const where = buildOrderWhere(query, user);
  const order = query.dir === 'asc' ? asc : desc;
  const [rows, [count]] = await Promise.all([
    selectOrdersWithRelations(db)
      .where(where)
      .orderBy(order(sortColumns[query.sort]), desc(orders.number))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
    db.select({ total: sql<number>`count(*)::int` }).from(orders).where(where),
  ]);
  return { items: rows.map((r) => toListItem(r, prefix)), total: count?.total ?? 0, page: query.page, pageSize: query.pageSize };
}

/** Per-status counts for the tabs (same filter, status ignored) + problems + calls due for me. */
export async function countByStatus(db: DbOrTx, filter: OrderFilter, user: SessionUser) {
  const where = buildOrderWhere(filter, user, { ignoreStatus: true });
  const [rows, [due]] = await Promise.all([
    db
      .select({ status: orders.status, count: sql<number>`count(*)::int`, problems: sql<number>`count(*) filter (where ${anyProblem})::int` })
      .from(orders)
      .where(where)
      .groupBy(orders.status),
    db.select({ n: sql<number>`count(*)::int` }).from(orders).where(dueForUser(user.id)),
  ]);
  return {
    byStatus: Object.fromEntries(rows.map((r) => [r.status, r.count])),
    total: rows.reduce((n, r) => n + r.count, 0),
    problems: rows.reduce((n, r) => n + r.problems, 0),
    due: due?.n ?? 0,
  };
}

/** Ids matching a filter — used by "delete all matching". */
export async function idsForFilter(db: DbOrTx, filter: OrderFilter, user: SessionUser): Promise<string[]> {
  const rows = await db.select({ id: orders.id }).from(orders).where(buildOrderWhere(filter, user));
  return rows.map((r) => r.id);
}

import { and, asc, desc, eq, ilike, inArray, isNotNull, isNull, notInArray, or, sql, type SQL } from 'drizzle-orm';
import { alias, type SelectedFields } from 'drizzle-orm/pg-core';
import { BLOCKING_PHONE_ISSUES, type OrderFilter, type OrderListItem, type OrderListQuery } from '@touraya/shared';
import { endOfDay, formatReference, parseReference, startOfDay } from '../../context';
import type { DbOrTx } from '../../db/client';
import { orders, products, sources, users } from '../../db/schema';
import type { SessionUser } from '../../lib/auth';

/** Translates the shared filter contract into SQL conditions. */
export function buildOrderWhere(filter: OrderFilter, user: SessionUser, opts: { ignoreStatus?: boolean } = {}): SQL | undefined {
  const conds: (SQL | undefined)[] = [filter.deleted ? isNotNull(orders.deletedAt) : isNull(orders.deletedAt)];

  if (filter.status?.length && !opts.ignoreStatus) conds.push(inArray(orders.status, filter.status));
  if (filter.productId) conds.push(eq(orders.productId, filter.productId));
  if (filter.sourceId) conds.push(eq(orders.sourceId, filter.sourceId));
  if (filter.wilayaCode) conds.push(eq(orders.wilayaCode, filter.wilayaCode));
  if (filter.assignedTo === 'me') conds.push(eq(orders.assignedToId, user.id));
  else if (filter.assignedTo === 'none') conds.push(isNull(orders.assignedToId));
  else if (typeof filter.assignedTo === 'number') conds.push(eq(orders.assignedToId, filter.assignedTo));
  if (filter.phoneIssue === true) conds.push(inArray(orders.phoneIssue, BLOCKING_PHONE_ISSUES));
  if (filter.phoneIssue === false)
    conds.push(or(isNull(orders.phoneIssue), notInArray(orders.phoneIssue, BLOCKING_PHONE_ISSUES)));
  if (filter.from) conds.push(sql`${orders.createdAt} >= ${startOfDay(filter.from)}`);
  if (filter.to) conds.push(sql`${orders.createdAt} < ${endOfDay(filter.to)}`);

  const q = filter.q?.trim();
  if (q) {
    const like = `%${q}%`;
    const digits = q.replace(/\D/g, '');
    const number = parseReference(q);
    conds.push(
      or(
        ilike(orders.customerName, like),
        ilike(orders.communeName, like),
        ilike(orders.communeRaw, like),
        ilike(orders.leadId, like),
        ilike(orders.colors, like),
        ilike(orders.offerRaw, like),
        digits.length >= 4 ? ilike(orders.phone, `%${digits.replace(/^0/, '')}%`) : undefined,
        digits.length >= 4 ? ilike(orders.phoneFacebook, `%${digits.replace(/^0/, '')}%`) : undefined,
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
  productId: orders.productId,
  productName: products.name,
  quantity: orders.quantity,
  price: orders.price,
  size: orders.size,
  colors: orders.colors,
  sourceId: orders.sourceId,
  sourceName: sources.name,
  assignedToId: orders.assignedToId,
  assignedToName: assignee.name,
  callAttempts: orders.callAttempts,
  commentCount: orders.commentCount,
  lastComment: orders.lastComment,
  createdAt: orders.createdAt,
  updatedAt: orders.updatedAt,
  deletedAt: orders.deletedAt,
};

export function selectOrdersWithRelations<T extends SelectedFields>(db: DbOrTx, extra: T = {} as T) {
  return db
    .select({ ...listSelection, ...extra })
    .from(orders)
    .leftJoin(products, eq(products.id, orders.productId))
    .leftJoin(sources, eq(sources.id, orders.sourceId))
    .leftJoin(assignee, eq(assignee.id, orders.assignedToId));
}

type ListRow = Omit<OrderListItem, 'reference' | 'createdAt' | 'updatedAt' | 'deletedAt'> & {
  number: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};

export function toListItem(row: ListRow, prefix: string): OrderListItem {
  const { number, createdAt, updatedAt, deletedAt, ...rest } = row;
  return {
    ...rest,
    reference: formatReference(prefix, number),
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
  return {
    items: rows.map((r) => toListItem(r, prefix)),
    total: count?.total ?? 0,
    page: query.page,
    pageSize: query.pageSize,
  };
}

/** Per-status counts for the status tabs (same filter, status ignored). */
export async function countByStatus(db: DbOrTx, filter: OrderFilter, user: SessionUser) {
  const where = buildOrderWhere(filter, user, { ignoreStatus: true });
  const rows = await db
    .select({
      status: orders.status,
      count: sql<number>`count(*)::int`,
      phoneIssues: sql<number>`count(*) filter (where ${inArray(orders.phoneIssue, BLOCKING_PHONE_ISSUES)})::int`,
      unassigned: sql<number>`count(*) filter (where ${orders.assignedToId} is null)::int`,
    })
    .from(orders)
    .where(where)
    .groupBy(orders.status);
  return {
    byStatus: Object.fromEntries(rows.map((r) => [r.status, r.count])),
    total: rows.reduce((n, r) => n + r.count, 0),
    phoneIssues: rows.reduce((n, r) => n + r.phoneIssues, 0),
    unassigned: rows.reduce((n, r) => n + r.unassigned, 0),
  };
}

/** Ids matching a filter — used by "delete all matching". */
export async function idsForFilter(db: DbOrTx, filter: OrderFilter, user: SessionUser): Promise<string[]> {
  const rows = await db.select({ id: orders.id }).from(orders).where(buildOrderWhere(filter, user));
  return rows.map((r) => r.id);
}

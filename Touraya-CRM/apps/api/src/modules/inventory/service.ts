import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { STOCK_MOVEMENT_LABELS, type StockMovementDTO, type StockMovementType } from '@touraya/shared';
import { formatReference } from '../../context';
import type { DbOrTx } from '../../db/client';
import { orderItems, orders, products, stockMovements, users, variants } from '../../db/schema';
import { opt } from '../catalog/service';

export interface MoveInput {
  variantId: number;
  type: StockMovementType;
  quantity: number; // signed: + in, − out
  note?: string | null;
  orderId?: string | null;
  actorId?: number | null;
}

/** The only way stock changes: ledger row + cached on-hand counter, in the same transaction. */
export async function moveStock(db: DbOrTx, moves: MoveInput[]) {
  const real = moves.filter((m) => m.quantity !== 0);
  if (!real.length) return;
  await db.insert(stockMovements).values(
    real.map((m) => ({ variantId: m.variantId, type: m.type, quantity: m.quantity, note: m.note ?? null, orderId: m.orderId ?? null, actorId: m.actorId ?? null })),
  );
  for (const m of real) await db.update(variants).set({ stock: sql`${variants.stock} + ${m.quantity}` }).where(eq(variants.id, m.variantId));
}

/** Pieces of an order that are linked to a variant. */
export async function orderPieces(db: DbOrTx, orderId: string, itemIds?: number[]) {
  return db
    .select({ id: orderItems.id, variantId: orderItems.variantId, quantity: orderItems.quantity })
    .from(orderItems)
    .where(and(eq(orderItems.orderId, orderId), isNotNull(orderItems.variantId), itemIds ? inArray(orderItems.id, itemIds.length ? itemIds : [-1]) : undefined));
}

/**
 * Moves an order's pieces out of (or back into) the warehouse.
 * `direction` −1 = shipped out, +1 = came back. Idempotency is ensured by orders.stock_out.
 */
export async function moveOrderStock(
  db: DbOrTx,
  order: { id: string; number: number },
  type: Extract<StockMovementType, 'ship' | 'ship_reversal' | 'return' | 'damaged'>,
  direction: 1 | -1,
  actorId: number | null,
  prefix: string,
  /** Only these pieces (partial return); all pieces when omitted. */
  itemIds?: number[],
) {
  const pieces = await orderPieces(db, order.id, itemIds);
  await moveStock(
    db,
    pieces.map((p) => ({
      variantId: p.variantId!,
      type,
      quantity: direction * p.quantity,
      orderId: order.id,
      actorId,
      note: `${STOCK_MOVEMENT_LABELS[type]} — ${formatReference(prefix, order.number)}`,
    })),
  );
  return pieces.reduce((n, p) => n + p.quantity, 0);
}

export async function listMovements(db: DbOrTx, prefix: string, opts: { variantIds?: number[]; limit?: number } = {}): Promise<StockMovementDTO[]> {
  const rows = await db
    .select({
      id: stockMovements.id,
      variantId: stockMovements.variantId,
      productName: products.name,
      size: variants.size,
      color: variants.color,
      type: stockMovements.type,
      quantity: stockMovements.quantity,
      note: stockMovements.note,
      orderId: stockMovements.orderId,
      orderNumber: orders.number,
      actorName: users.name,
      createdAt: stockMovements.createdAt,
    })
    .from(stockMovements)
    .innerJoin(variants, eq(variants.id, stockMovements.variantId))
    .innerJoin(products, eq(products.id, variants.productId))
    .leftJoin(orders, eq(orders.id, stockMovements.orderId))
    .leftJoin(users, eq(users.id, stockMovements.actorId))
    .where(opts.variantIds ? inArray(stockMovements.variantId, opts.variantIds) : undefined)
    .orderBy(desc(stockMovements.id))
    .limit(opts.limit ?? 200);
  return rows.map(({ orderNumber, createdAt, size, color, ...r }) => ({
    ...r,
    size: opt(size),
    color: opt(color),
    orderReference: orderNumber ? formatReference(prefix, orderNumber) : null,
    createdAt: createdAt.toISOString(),
  }));
}

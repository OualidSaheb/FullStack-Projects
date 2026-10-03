import { asc, eq, inArray } from 'drizzle-orm';
import { draftItems, type OrderItemInput } from '@touraya/shared';
import type { DbOrTx } from '../../db/client';
import { offers, orderItems, products } from '../../db/schema';
import { findVariantIds } from '../catalog/service';

/** Replaces the pieces of an order, linking each one to its stock variant when size/color are known. */
export async function replaceItems(db: DbOrTx, orderId: string, items: OrderItemInput[]) {
  await db.delete(orderItems).where(eq(orderItems.orderId, orderId));
  if (!items.length) return;
  const filled = await withSingleOptions(db, items);
  const variantIds = await findVariantIds(db, filled);
  await db.insert(orderItems).values(
    filled.map((i, k) => ({ orderId, productId: i.productId, variantId: variantIds[k] ?? null, size: i.size ?? '', color: i.color ?? '', quantity: i.quantity })),
  );
}

/** A product with a single size or color: pieces always carry it (nothing for the agent to pick). */
async function withSingleOptions(db: DbOrTx, items: OrderItemInput[]): Promise<OrderItemInput[]> {
  const ids = [...new Set(items.map((i) => i.productId))];
  const prods = await db.select({ id: products.id, sizes: products.sizes, colors: products.colors }).from(products).where(inArray(products.id, ids));
  return items.map((i) => {
    const p = prods.find((x) => x.id === i.productId);
    return { ...i, size: i.size || (p?.sizes.length === 1 ? p.sizes[0]! : i.size ?? null), color: i.color || (p?.colors.length === 1 ? p.colors[0]! : i.color ?? null) };
  });
}

/** Pieces for an offer, pre-filled from the customer's answers ("أسود_رمادي", "L"). `units` overrides the offer's piece count. */
export async function draftOfferItems(db: DbOrTx, offerId: number | null, request: { size?: string | null; colors?: string | null }, units?: number): Promise<OrderItemInput[]> {
  if (!offerId) return [];
  const [row] = await db
    .select({ units: offers.units, productId: products.id, sizes: products.sizes, colors: products.colors })
    .from(offers)
    .innerJoin(products, eq(products.id, offers.productId))
    .where(eq(offers.id, offerId));
  if (!row) return [];
  return draftItems(units ?? row.units, request, row).map((d) => ({ productId: row.productId, size: d.size, color: d.color, quantity: 1 }));
}

export async function loadItems(db: DbOrTx, orderIds: string[]) {
  if (!orderIds.length) return [];
  return db
    .select({ id: orderItems.id, orderId: orderItems.orderId, productId: orderItems.productId, productName: products.name, variantId: orderItems.variantId, size: orderItems.size, color: orderItems.color, quantity: orderItems.quantity, returnCondition: orderItems.returnCondition })
    .from(orderItems)
    .innerJoin(products, eq(products.id, orderItems.productId))
    .where(inArray(orderItems.orderId, orderIds))
    .orderBy(asc(orderItems.id));
}

export const itemsLabel = (items: { size: string; color: string; quantity: number }[]) =>
  items.map((i) => [i.quantity > 1 ? `${i.quantity}×` : '', i.size, i.color].filter(Boolean).join(' ')).filter(Boolean).join(' + ');

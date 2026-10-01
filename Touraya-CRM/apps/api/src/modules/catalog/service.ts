import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { RESERVING_STATUSES, type OfferDTO, type ProductDTO, type ProductInput, type VariantDTO } from '@touraya/shared';
import type { DbOrTx } from '../../db/client';
import { offers, orderItems, orders, products, variants } from '../../db/schema';

type ProductRow = typeof products.$inferSelect;
type VariantRow = typeof variants.$inferSelect;

/** '' in the database ↔ null in the API (no such option). */
export const opt = (v: string | null | undefined) => v || null;

/**
 * Keeps one variant per size × color. Removed options deactivate their
 * variants (history and stock are kept), re-added ones come back.
 */
export async function syncVariants(db: DbOrTx, product: Pick<ProductRow, 'id' | 'sizes' | 'colors' | 'sku'>) {
  const sizes = product.sizes.length ? product.sizes : [''];
  const colors = product.colors.length ? product.colors : [''];
  const wanted = sizes.flatMap((size) => colors.map((color) => ({ size, color })));
  const existing = await db.select().from(variants).where(eq(variants.productId, product.id));
  const key = (v: { size: string; color: string }) => `${v.size}\u0000${v.color}`;
  const wantedKeys = new Set(wanted.map(key));

  const toInsert = wanted.filter((w) => !existing.some((e) => key(e) === key(w)));
  if (toInsert.length)
    await db.insert(variants).values(
      toInsert.map((w) => ({ productId: product.id, size: w.size, color: w.color, sku: [product.sku, w.size, w.color].filter(Boolean).join('-') })),
    );
  for (const e of existing) {
    const active = wantedKeys.has(key(e));
    if (e.active !== active) await db.update(variants).set({ active }).where(eq(variants.id, e.id));
  }
}

/** Pieces reserved by confirmed (not yet shipped) orders, per variant. */
export async function reservedByVariant(db: DbOrTx, variantIds?: number[]): Promise<Map<number, number>> {
  const rows = await db
    .select({ variantId: orderItems.variantId, n: sql<number>`sum(${orderItems.quantity})::int` })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(
      and(
        inArray(orders.status, RESERVING_STATUSES),
        isNull(orders.deletedAt),
        variantIds ? inArray(orderItems.variantId, variantIds.length ? variantIds : [-1]) : undefined,
      ),
    )
    .groupBy(orderItems.variantId);
  return new Map(rows.filter((r) => r.variantId !== null).map((r) => [r.variantId!, r.n]));
}

export function toVariantDTO(v: VariantRow, reserved: number): VariantDTO {
  return { id: v.id, size: opt(v.size), color: opt(v.color), sku: v.sku, stock: v.stock, reserved, available: v.stock - reserved, active: v.active };
}

export async function listProducts(db: DbOrTx): Promise<ProductDTO[]> {
  const [rows, allVariants, reserved] = await Promise.all([
    db.select().from(products).orderBy(products.id),
    db.select().from(variants).orderBy(variants.id),
    reservedByVariant(db),
  ]);
  return rows.map(({ createdAt: _c, updatedAt: _u, ...p }) => ({
    ...p,
    variants: allVariants.filter((v) => v.productId === p.id).map((v) => toVariantDTO(v, reserved.get(v.id) ?? 0)),
  }));
}

export async function saveProduct(db: DbOrTx, input: ProductInput, id?: number) {
  const [row] = id
    ? await db.update(products).set({ ...input, updatedAt: new Date() }).where(eq(products.id, id)).returning()
    : await db.insert(products).values(input).returning();
  if (row) await syncVariants(db, row);
  return row;
}

export const toOfferDTO = ({ createdAt: _c, updatedAt: _u, ...o }: typeof offers.$inferSelect): OfferDTO => o;

/** Finds the variant of a product for a size/color pair (null when the pair is incomplete). */
export async function findVariantIds(db: DbOrTx, items: { productId: number; size: string | null; color: string | null }[]) {
  const productIds = [...new Set(items.map((i) => i.productId))];
  if (!productIds.length) return [];
  const [rows, prods] = await Promise.all([
    db.select().from(variants).where(inArray(variants.productId, productIds)),
    db.select({ id: products.id, sizes: products.sizes, colors: products.colors }).from(products).where(inArray(products.id, productIds)),
  ]);
  return items.map((i) => {
    const p = prods.find((x) => x.id === i.productId);
    // A required option that is missing means the piece is not identified yet.
    if (!p || (p.sizes.length && !i.size) || (p.colors.length && !i.color)) return null;
    return rows.find((v) => v.productId === i.productId && v.size === (i.size ?? '') && v.color === (i.color ?? ''))?.id ?? null;
  });
}

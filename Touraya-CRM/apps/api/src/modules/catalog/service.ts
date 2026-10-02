import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { RESERVING_STATUSES, type OfferDTO, type ProductDTO, type ProductInput, type ProductTierInput, type Tier, type VariantDTO } from '@touraya/shared';
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
    db.select().from(products).where(isNull(products.deletedAt)).orderBy(products.id),
    db.select().from(variants).orderBy(variants.id),
    reservedByVariant(db),
  ]);
  return rows.map(({ createdAt: _c, updatedAt: _u, deletedAt: _d, ...p }) => ({
    ...p,
    variants: allVariants.filter((v) => v.productId === p.id).map((v) => toVariantDTO(v, reserved.get(v.id) ?? 0)),
  }));
}

export async function saveProduct(db: DbOrTx, input: ProductInput, id?: number) {
  const { tiers, ...fields } = input;
  const [row] = id
    ? await db.update(products).set({ ...fields, updatedAt: new Date() }).where(eq(products.id, id)).returning()
    : await db.insert(products).values(fields).returning();
  if (row) await syncVariants(db, row);
  if (row && tiers) await syncTiers(db, row, tiers);
  return row;
}

/** "p 2pcs 3500": short code for the parcel label (the product is not written in full). */
export const tierCarrierName = (product: Pick<ProductRow, 'name' | 'sku'>, units: number, price: number) =>
  `${(product.sku || product.name).trim().charAt(0).toLowerCase() || 'p'} ${units}${units === 1 ? 'pc' : 'pcs'} ${price}`;

/**
 * The product's price list (1 piece = 2100, 2 = 3500…) becomes its offers:
 * lines are updated in place (same offer, past orders keep pointing at it),
 * new lines create offers, removed lines archive theirs.
 */
export async function syncTiers(db: DbOrTx, product: ProductRow, tiers: ProductTierInput[]) {
  const existing = await db.select().from(offers).where(and(eq(offers.productId, product.id), isNull(offers.deletedAt)));
  const kept = new Set<number>();
  for (const t of tiers) {
    const carrierName = t.carrierName || tierCarrierName(product, t.units, t.price);
    const values = { units: t.units, price: t.price, carrierName, name: t.name || `${product.name} ${t.units}${t.units === 1 ? 'pc' : 'pcs'} ${t.price}` };
    // A line without id takes over an offer with the same piece count, rather than duplicating it.
    const match = existing.find((o) => !kept.has(o.id) && (t.id ? o.id === t.id : o.units === t.units && !tiers.some((x) => x.id === o.id)));
    if (match) {
      kept.add(match.id);
      await db.update(offers).set({ ...values, updatedAt: new Date() }).where(eq(offers.id, match.id));
    } else {
      await db.insert(offers).values({ ...values, productId: product.id });
    }
  }
  const removed = existing.filter((o) => !kept.has(o.id)).map((o) => o.id);
  if (removed.length) await db.update(offers).set({ deletedAt: new Date(), active: false }).where(inArray(offers.id, removed));
}

export const toOfferDTO = ({ createdAt: _c, updatedAt: _u, deletedAt: _d, ...o }: typeof offers.$inferSelect): OfferDTO => o;

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

/** A product's active offers as price tiers (1 piece, 2 pieces, 3 pieces…). */
export async function productTiers(db: DbOrTx, productId: number): Promise<Tier[]> {
  return db
    .select({ id: offers.id, units: offers.units, price: offers.price, carrierName: offers.carrierName, name: offers.name })
    .from(offers)
    .where(and(eq(offers.productId, productId), eq(offers.active, true), isNull(offers.deletedAt)));
}

/** Adds sizes/colors to a product (keeps existing ones and their order) and creates the new variants. */
export async function addProductOptions(db: DbOrTx, productId: number, add: { sizes: string[]; colors: string[] }) {
  const [p] = await db.select().from(products).where(eq(products.id, productId));
  if (!p) return null;
  const merge = (current: string[], extra: string[]) => [...current, ...extra.filter((x) => !current.some((c) => c.trim() === x.trim()))];
  const [row] = await db
    .update(products)
    .set({ sizes: merge(p.sizes, add.sizes), colors: merge(p.colors, add.colors), updatedAt: new Date() })
    .where(eq(products.id, productId))
    .returning();
  await syncVariants(db, row!);
  return row!;
}

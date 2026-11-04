import { and, eq, isNotNull } from 'drizzle-orm';
import { computeCarrierStats, looseKey, type CarrierStatParcel, type CarrierStats } from '@touraya/shared';
import type { AppContext } from '../../context';
import { carriers, offers, orders, products } from '../../db/schema';
import { HttpError } from '../../lib/errors';
import { ADAPTERS } from '../carriers/registry';
import { loadCarrierRow } from '../carriers/service';
import type { CarrierParcel } from '../carriers/types';
import { listAdSpend } from '../ads/routes';
import { getSettings } from '../settings/service';

/** Parcels read from the carrier, kept a while: each page is a request the carrier counts. */
const CACHE_MS = 15 * 60_000;
const cache = new Map<number, { at: number; parcels: CarrierParcel[] }>();

export type CarrierStatsDTO = CarrierStats & { fetchedAt: string; carriers: string[]; withoutCost: string[] };

/**
 * The delivery company's real figures: every parcel of its account (sent by
 * the platform, by hand in its dashboard, by file…), each one's offer and
 * cost taken from the platform when known (its order, else its product text).
 */
export async function carrierStats(ctx: AppContext, refresh: boolean): Promise<CarrierStatsDTO> {
  const rows = await ctx.db.select().from(carriers).where(and(eq(carriers.active, true), eq(carriers.apiEnabled, true)));
  const usable = rows.map((r) => loadCarrierRow(ctx.secrets, r)).filter((c) => ADAPTERS[c.provider]?.listParcels);
  if (!usable.length) throw new HttpError(400, 'لا توجد شركة توصيل مربوطة بالـ API — فعّل «الإرسال المباشر عبر API» في شركات التوصيل');

  // Offers and what their pieces cost, recognised by name or by the name sent to the carrier.
  const catalog = await ctx.db
    .select({ id: offers.id, name: offers.name, carrierName: offers.carrierName, units: offers.units, costPrice: products.costPrice })
    .from(offers)
    .innerJoin(products, eq(products.id, offers.productId));
  const offerById = new Map(catalog.map((o) => [o.id, o]));
  const offerByText = new Map<string, (typeof catalog)[number]>();
  for (const o of catalog) for (const t of [o.carrierName, o.name]) if (t) offerByText.set(looseKey(t), o);
  const linked = new Map(
    (await ctx.db.select({ tracking: orders.carrierTracking, offerId: orders.offerId }).from(orders).where(isNotNull(orders.carrierTracking))).map((o) => [o.tracking!, o.offerId]),
  );

  const parcels: CarrierStatParcel[] = [];
  const withoutCost = new Set<string>();
  for (const carrier of usable) {
    const cached = cache.get(carrier.id);
    const list = !refresh && cached && Date.now() - cached.at < CACHE_MS ? cached.parcels : await ADAPTERS[carrier.provider]!.listParcels!(carrier, new Date(0));
    if (!cached || list !== cached.parcels) cache.set(carrier.id, { at: Date.now(), parcels: list });
    for (const p of list) {
      const offerId = linked.get(p.tracking);
      const offer = (offerId ? offerById.get(offerId) : undefined) ?? offerByText.get(looseKey(p.productList ?? ''));
      const cost = offer && offer.costPrice > 0 ? offer.costPrice * offer.units : null;
      const label = offer?.name ?? (p.productList?.trim() || '—');
      if (cost === null) withoutCost.add(label);
      parcels.push({
        tracking: p.tracking,
        createdAt: p.createdAt?.toISOString() ?? null,
        lastStatusAt: p.lastStatusAt?.toISOString() ?? null,
        status: p.status ?? null,
        price: p.price ?? 0,
        deliveryFee: p.deliveryFee ?? 0,
        freeShipping: p.freeShipping ?? false,
        stopdesk: p.stopdesk ?? false,
        wilayaCode: p.wilayaCode ?? null,
        offer: label,
        cost,
        paymentStatus: p.paymentStatus ?? null,
        inPlatform: linked.has(p.tracking),
      });
    }
  }
  const { returnFee, confirmFee, confirmFeeOn } = (await getSettings(ctx.db)).calculator;
  const ads = (await listAdSpend(ctx.db)).map((a) => ({ day: a.day, usd: a.amountUsd, da: a.amountUsd * a.usdRate, offer: a.offerName }));
  const fetchedAt = Math.min(...usable.map((c) => cache.get(c.id)?.at ?? Date.now()));
  return {
    ...computeCarrierStats(parcels, { returnFee, confirmFee, confirmFeeOn }, ads),
    fetchedAt: new Date(fetchedAt).toISOString(),
    carriers: usable.map((c) => c.name),
    withoutCost: [...withoutCost],
  };
}

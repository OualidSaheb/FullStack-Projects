/**
 * Price by number of pieces from a product's offers (tiers).
 * 1 = 2100, 2 = 3500, 3 = 4999 … An exact tier is used as is; any other count
 * is the cheapest combination of tiers (4 = 3 + 1 → 4999 + 2100), so the
 * customer always gets the best price the offers allow.
 */
export interface Tier {
  id: number;
  units: number;
  price: number;
  carrierName: string;
  name?: string;
}

export interface OfferCombination {
  price: number;
  /** Offer whose units equal the piece count, if any. */
  exactOfferId: number | null;
  /** Largest tier used — the order's reference offer. */
  mainOfferId: number;
  parts: { tier: Tier; count: number }[];
  /** "p 3pcs 4999 + p 1pc 2100" — what goes on the carrier label. */
  carrierLabel: string;
}

export function combineOffers(tiers: Tier[], units: number): OfferCombination | null {
  const usable = tiers.filter((t) => t.units > 0);
  if (units < 1 || !usable.length) return null;
  // Unbounded knapsack: cheapest exact total of `units` pieces.
  const best: ({ price: number; tier: Tier } | null)[] = Array(units + 1).fill(null);
  const cost = (n: number) => (n === 0 ? 0 : best[n]?.price ?? Infinity);
  for (let n = 1; n <= units; n++) {
    for (const t of usable) {
      if (t.units > n || cost(n - t.units) === Infinity) continue;
      const price = cost(n - t.units) + t.price;
      // Tie: prefer bigger tiers (fewer parts on the label).
      if (!best[n] || price < best[n]!.price || (price === best[n]!.price && t.units > best[n]!.tier.units)) best[n] = { price, tier: t };
    }
  }
  if (!best[units]) return null;
  const counts = new Map<number, { tier: Tier; count: number }>();
  for (let n = units; n > 0; n -= best[n]!.tier.units) {
    const t = best[n]!.tier;
    counts.set(t.id, { tier: t, count: (counts.get(t.id)?.count ?? 0) + 1 });
  }
  const parts = [...counts.values()].sort((a, b) => b.tier.units - a.tier.units);
  return {
    price: best[units]!.price,
    exactOfferId: usable.find((t) => t.units === units)?.id ?? null,
    mainOfferId: parts[0]!.tier.id,
    parts,
    carrierLabel: parts.map((p) => (p.count > 1 ? `${p.count} × ${p.tier.carrierName}` : p.tier.carrierName)).join(' + '),
  };
}

/** "pants 2pcs 3500" or "2 × pants 2pcs 3500 + pants 1pc 2100" — for the agent. */
export const combinationLabel = (c: OfferCombination) =>
  c.parts.map((p) => `${p.count > 1 ? `${p.count} × ` : ''}${p.tier.name ?? p.tier.carrierName}`).join(' + ');

import { statusFromYalidine } from './statuses';

/**
 * Statistics of everything at the delivery company, read from its own
 * account (parcels created by the platform, by hand in its dashboard, by
 * file…): counts, delivery and return rates, money, profit before ads, by
 * month, week, offer and wilaya. Pure arithmetic, tested on its own.
 */

/** One parcel as the carrier reports it, with what the platform knows of its cost. */
export interface CarrierStatParcel {
  tracking: string;
  /** ISO dates. */
  createdAt: string | null;
  lastStatusAt: string | null;
  /** The carrier's own label ("Livré", "Retourné au vendeur"…). */
  status: string | null;
  /** Amount collected from the customer for the goods (DA). */
  price: number;
  deliveryFee: number;
  /** Delivery paid by the seller. */
  freeShipping: boolean;
  stopdesk: boolean;
  wilayaCode: number | null;
  /** Offer name when recognised, otherwise the carrier's product text. */
  offer: string;
  /** What the parcel's pieces cost to make (DA), when known. */
  cost: number | null;
  paymentStatus: string | null;
  /** Also an order in the platform. */
  inPlatform: boolean;
}

/** A day's ad spend, in dinars already (dollars × that day's rate). */
export interface CarrierStatAd {
  day: string;
  usd: number;
  da: number;
  /** Offer name when the spend was for one offer. */
  offer: string | null;
}

export interface CarrierStatOptions {
  /** Charged by the carrier on a returned parcel (DA). */
  returnFee: number;
  /** Paid to the agent for a confirmed (or delivered) order (DA). */
  confirmFee: number;
  confirmFeeOn: 'confirmed' | 'delivered';
}

export type ParcelStage = 'delivered' | 'returned' | 'failed' | 'transit' | 'notShipped' | 'cancelled';

export interface CarrierGroupStats {
  parcels: number;
  delivered: number;
  returned: number;
  /** Failed attempt, still with the carrier. */
  failed: number;
  transit: number;
  notShipped: number;
  cancelled: number;
  /** Delivered out of finished (delivered + returned), %. */
  deliveryRate: number;
  returnRate: number;
  /** Goods amount of delivered parcels. */
  revenue: number;
  /** Goods amount of parcels still on their way. */
  pending: number;
  /** Goods amount of returned parcels. */
  lostSales: number;
  productCost: number;
  /** Delivery paid by the seller on delivered parcels. */
  sellerDelivery: number;
  returnCosts: number;
  confirmCosts: number;
  /** Revenue minus everything above (ads not included). */
  profit: number;
  /** Ad spend of the same period / offer (dollars, and dinars at each day's rate). */
  adsUsd: number;
  ads: number;
  profitAfterAds: number;
  /** Delivered parcels whose cost is unknown (their goods counted as free). */
  unknownCost: number;
  /** Average days from creation to delivery. */
  avgDeliveryDays: number | null;
}

export interface CarrierStats {
  totals: CarrierGroupStats;
  byMonth: (CarrierGroupStats & { key: string })[];
  byWeek: (CarrierGroupStats & { key: string })[];
  byOffer: (CarrierGroupStats & { key: string })[];
  byWilaya: (CarrierGroupStats & { key: number | null })[];
  /** Ad spend by day and by month (newest first). */
  adsByDay: { day: string; usd: number; da: number }[];
  adsByMonth: { key: string; usd: number; da: number }[];
  /** The carrier's own labels and how many parcels carry each. */
  statuses: { label: string; stage: ParcelStage; count: number }[];
  payments: { status: string; count: number; amount: number }[];
  inPlatform: number;
}

export function parcelStage(label: string | null): ParcelStage {
  const s = label ? statusFromYalidine(label) : null;
  if (s === 'delivered') return 'delivered';
  if (s === 'returned' || s === 'return_received') return 'returned';
  if (s === 'delivery_failed') return 'failed';
  if (s === 'cancelled') return 'cancelled';
  if (s === 'sent_to_carrier') return 'notShipped';
  return 'transit';
}

const rate = (part: number, whole: number) => (whole ? Math.round((part / whole) * 1000) / 10 : 0);
/** Algeria (UTC+1) calendar day of an ISO date. */
const dayDZ = (iso: string) => new Date(new Date(iso).getTime() + 3600_000).toISOString().slice(0, 10);

/** Monday of the week (Algeria time), as YYYY-MM-DD. */
export function weekKey(iso: string): string {
  const d = new Date(`${dayDZ(iso)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

export function group(parcels: CarrierStatParcel[], opts: CarrierStatOptions): CarrierGroupStats {
  const g: CarrierGroupStats = {
    parcels: parcels.length,
    delivered: 0,
    returned: 0,
    failed: 0,
    transit: 0,
    notShipped: 0,
    cancelled: 0,
    deliveryRate: 0,
    returnRate: 0,
    revenue: 0,
    pending: 0,
    lostSales: 0,
    productCost: 0,
    sellerDelivery: 0,
    returnCosts: 0,
    confirmCosts: 0,
    profit: 0,
    adsUsd: 0,
    ads: 0,
    profitAfterAds: 0,
    unknownCost: 0,
    avgDeliveryDays: null,
  };
  let days = 0;
  let timed = 0;
  for (const p of parcels) {
    const stage = parcelStage(p.status);
    g[stage]++;
    if (stage === 'cancelled') continue;
    if (opts.confirmFeeOn === 'confirmed') g.confirmCosts += opts.confirmFee;
    if (stage === 'delivered') {
      g.revenue += p.price;
      if (p.cost === null) g.unknownCost++;
      else g.productCost += p.cost;
      if (p.freeShipping) g.sellerDelivery += p.deliveryFee;
      if (opts.confirmFeeOn === 'delivered') g.confirmCosts += opts.confirmFee;
      if (p.createdAt && p.lastStatusAt) {
        days += (new Date(p.lastStatusAt).getTime() - new Date(p.createdAt).getTime()) / 86400_000;
        timed++;
      }
    } else if (stage === 'returned') {
      g.lostSales += p.price;
      g.returnCosts += opts.returnFee;
    } else {
      g.pending += p.price;
    }
  }
  const finished = g.delivered + g.returned;
  g.deliveryRate = rate(g.delivered, finished);
  g.returnRate = rate(g.returned, finished);
  // Parcels still on their way only cost their confirmation so far.
  g.profit = g.revenue - g.productCost - g.sellerDelivery - g.returnCosts - g.confirmCosts;
  g.avgDeliveryDays = timed ? Math.round((days / timed) * 10) / 10 : null;
  g.profitAfterAds = g.profit;
  return g;
}

/** Puts the ad spend on a group: ads of its period or offer, profit after them. */
function withAds<T extends CarrierGroupStats>(g: T, ads: CarrierStatAd[]): T {
  const usd = ads.reduce((n, a) => n + a.usd, 0);
  const da = ads.reduce((n, a) => n + a.da, 0);
  return { ...g, adsUsd: usd, ads: da, profitAfterAds: g.profit - da };
}

function groupBy<K extends string | number | null>(parcels: CarrierStatParcel[], key: (p: CarrierStatParcel) => K, opts: CarrierStatOptions) {
  const buckets = new Map<K, CarrierStatParcel[]>();
  for (const p of parcels) {
    const k = key(p);
    buckets.set(k, [...(buckets.get(k) ?? []), p]);
  }
  return [...buckets].map(([k, list]) => ({ key: k, ...group(list, opts) }));
}

export function computeCarrierStats(parcels: CarrierStatParcel[], opts: CarrierStatOptions, ads: CarrierStatAd[] = []): CarrierStats {
  const dated = parcels.filter((p) => p.createdAt);
  const byDate = (a: { key: string }, b: { key: string }) => b.key.localeCompare(a.key);
  const labels = new Map<string, number>();
  for (const p of parcels) labels.set(p.status ?? '—', (labels.get(p.status ?? '—') ?? 0) + 1);
  const payments = new Map<string, { count: number; amount: number }>();
  for (const p of parcels) {
    if (parcelStage(p.status) !== 'delivered' || !p.paymentStatus) continue;
    const cur = payments.get(p.paymentStatus) ?? { count: 0, amount: 0 };
    payments.set(p.paymentStatus, { count: cur.count + 1, amount: cur.amount + p.price });
  }
  const sumBy = (key: (a: CarrierStatAd) => string) => {
    const m = new Map<string, { usd: number; da: number }>();
    for (const a of ads) {
      const cur = m.get(key(a)) ?? { usd: 0, da: 0 };
      m.set(key(a), { usd: cur.usd + a.usd, da: cur.da + a.da });
    }
    return m;
  };
  // A period shows its own spend, even a month with ads and no parcel yet.
  const months = groupBy(dated, (p) => dayDZ(p.createdAt!).slice(0, 7), opts);
  for (const k of sumBy((a) => a.day.slice(0, 7)).keys()) if (!months.some((m) => m.key === k)) months.push({ key: k, ...group([], opts) });
  const weeks = groupBy(dated, (p) => weekKey(p.createdAt!), opts);
  for (const k of sumBy((a) => weekKey(`${a.day}T12:00:00Z`)).keys()) if (!weeks.some((w) => w.key === k)) weeks.push({ key: k, ...group([], opts) });
  return {
    totals: withAds(group(parcels, opts), ads),
    byMonth: months.map((m) => withAds(m, ads.filter((a) => a.day.slice(0, 7) === m.key))).sort(byDate),
    byWeek: weeks.map((w) => withAds(w, ads.filter((a) => weekKey(`${a.day}T12:00:00Z`) === w.key))).sort(byDate),
    // Per offer: only the spend typed for that offer.
    byOffer: groupBy(parcels, (p) => p.offer || '—', opts)
      .map((o) => withAds(o, ads.filter((a) => a.offer === o.key)))
      .sort((a, b) => b.parcels - a.parcels),
    adsByDay: [...sumBy((a) => a.day)].map(([day, v]) => ({ day, ...v })).sort((a, b) => b.day.localeCompare(a.day)),
    adsByMonth: [...sumBy((a) => a.day.slice(0, 7))].map(([key, v]) => ({ key, ...v })).sort(byDate),
    byWilaya: groupBy(parcels, (p) => p.wilayaCode, opts).sort((a, b) => b.parcels - a.parcels),
    statuses: [...labels].map(([label, count]) => ({ label, stage: parcelStage(label === '—' ? null : label), count })).sort((a, b) => b.count - a.count),
    payments: [...payments].map(([status, v]) => ({ status, ...v })),
    inPlatform: parcels.filter((p) => p.inPlatform).length,
  };
}

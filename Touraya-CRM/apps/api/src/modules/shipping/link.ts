import { and, asc, eq, isNotNull, isNull, ne } from 'drizzle-orm';
import { normalizePhone, STOCK_OUT_STATUSES, type OrderStatus } from '@touraya/shared';
import { formatReference, parseReference, type AppContext } from '../../context';
import { carriers, orders } from '../../db/schema';
import type { SessionUser } from '../../lib/auth';
import { ADAPTERS } from '../carriers/registry';
import { loadCarrierRow } from '../carriers/service';
import type { CarrierParcel } from '../carriers/types';
import { logEvents } from '../orders/events';
import { emitStatusEvents, transitionContext, type StatusEvent } from '../orders/service';
import { transitionStatus } from '../orders/transitions';

/** What made the match: shown to the admin before linking. */
export type MatchClue = 'reference' | 'phone' | 'wilaya' | 'commune' | 'price' | 'name';

export interface ParcelLink {
  orderId: string;
  reference: string;
  customerName: string;
  from: OrderStatus;
  to: OrderStatus;
  tracking: string;
  carrierStatus: string | null;
  carrierName: string;
  clues: MatchClue[];
  /** Several clues agree: selected by default. Otherwise "probable", left for the admin to tick. */
  strong: boolean;
}

export interface UnlinkedParcel {
  tracking: string;
  name: string;
  phone: string;
  status: string | null;
  createdAt: string | null;
  /** Several orders fit equally well: left for the admin rather than guessed. */
  ambiguous: boolean;
}

/** A parcel made a little before its order was saved (clock gaps, late sheet sync) still counts. */
const GRACE_MS = 24 * 3600_000;
/** Phone ends + wilaya + price: shown as probable. A name or commune on top (or a full phone): strong. */
const MIN_SCORE = 6;
const STRONG_SCORE = 7;

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const isMasked = (s: string) => s.includes('*');

/** "0********4" against a real number: same first and last digit (all digits when not masked). */
function phoneFits(given: string, phones: string[]) {
  const g = given.replace(/\s+/g, '');
  if (!g) return false;
  if (!isMasked(g)) return phones.includes(normalizePhone(g).value);
  const first = g[0];
  const last = g[g.length - 1];
  return phones.some((p) => p[0] === first && p[p.length - 1] === last);
}

/** Masked word ("s****a") fits a word: same length, visible letters in place. */
function wordFits(masked: string, word: string) {
  if (masked.length !== word.length) return false;
  for (let i = 0; i < masked.length; i++) if (masked[i] !== '*' && masked[i] !== word[i]) return false;
  return true;
}

/** Some word of the carrier's (masked) name is a word of the customer's name. */
function nameFits(given: string, name: string) {
  const words = fold(name).split(/\s+/).filter(Boolean);
  const masked = fold(given).split(/\s+/).filter((w) => w.replace(/[*/]/g, '').length > 0);
  return masked.some((m) => words.some((w) => (isMasked(m) ? wordFits(m, w) : m === w)));
}

/**
 * Parcels sent before the platform did it (by hand in the carrier's dashboard,
 * Excel uploads…): found at the carrier and linked to their orders, so their
 * status follows like the others. Our reference typed at the carrier is
 * certain; otherwise Yalidine hides phones and names in its lists, so the
 * order is recognised from several clues together: the phone's first and last
 * digits, the wilaya, the commune, the price, the visible letters of the name,
 * an order made before the parcel. Ties are left unlinked. Preview first, then apply.
 */
export async function linkExistingParcels(ctx: AppContext, user: SessionUser | null, apply: boolean, only?: string[]) {
  const prefix = ctx.config.ORDER_PREFIX;
  const [oldest] = await ctx.db.select({ at: orders.createdAt }).from(orders).where(isNull(orders.deletedAt)).orderBy(asc(orders.createdAt)).limit(1);
  const result = { links: [] as ParcelLink[], unlinked: [] as UnlinkedParcel[], alreadyLinked: 0, parcels: 0 };
  if (!oldest) return result;

  const known = new Set((await ctx.db.select({ t: orders.carrierTracking }).from(orders).where(isNotNull(orders.carrierTracking))).map((r) => r.t!));
  const candidates = (
    await ctx.db
      .select({
        id: orders.id,
        number: orders.number,
        customerName: orders.customerName,
        status: orders.status,
        createdAt: orders.createdAt,
        wilayaCode: orders.wilayaCode,
        communeName: orders.communeName,
        price: orders.price,
        phone: orders.phone,
        phoneAlt: orders.phoneAlt,
        phoneCustomer: orders.phoneCustomer,
        phoneFacebook: orders.phoneFacebook,
      })
      .from(orders)
      .where(and(isNull(orders.deletedAt), isNull(orders.carrierTracking), ne(orders.status, 'cancelled')))
  ).map((o) => ({ ...o, phones: [...new Set([o.phone, o.phoneAlt, o.phoneCustomer, o.phoneFacebook].map((v) => normalizePhone(v).value).filter(Boolean))] }));
  type Candidate = (typeof candidates)[number];
  const byNumber = new Map(candidates.map((o) => [o.number, o]));

  const score = (parcel: CarrierParcel, o: Candidate): { score: number; clues: MatchClue[] } | null => {
    if (o.createdAt.getTime() > (parcel.createdAt?.getTime() ?? Date.now()) + GRACE_MS) return null;
    if (!parcel.phones.some((p) => phoneFits(p, o.phones))) return null;
    if (parcel.wilayaCode && o.wilayaCode && parcel.wilayaCode !== o.wilayaCode) return null;
    const clues: MatchClue[] = ['phone'];
    let s = parcel.phones.some((p) => !isMasked(p)) ? STRONG_SCORE : 1;
    if (parcel.wilayaCode && parcel.wilayaCode === o.wilayaCode) {
      s += 2;
      clues.push('wilaya');
    }
    if (parcel.commune && o.communeName && fold(parcel.commune) === fold(o.communeName)) {
      s += 1;
      clues.push('commune');
    }
    // The price at the carrier may include the delivery fee.
    if (parcel.price !== undefined && o.price > 0 && parcel.price >= o.price && parcel.price - o.price <= 1500) {
      s += parcel.price === o.price ? 3 : 1;
      clues.push('price');
    }
    if (parcel.name && nameFits(parcel.name, o.customerName)) {
      s += 2;
      clues.push('name');
    }
    return { score: s, clues };
  };

  const rows = await ctx.db.select().from(carriers).where(and(eq(carriers.active, true), eq(carriers.apiEnabled, true)));
  const matched: { link: ParcelLink; parcel: CarrierParcel; carrierId: number }[] = [];
  const used = new Set<string>();
  for (const row of rows) {
    const carrier = loadCarrierRow(ctx.secrets, row);
    const adapter = ADAPTERS[carrier.provider];
    if (!adapter?.listParcels) continue;
    const parcels = await adapter.listParcels(carrier, new Date(oldest.at.getTime() - GRACE_MS));
    result.parcels += parcels.length;

    const take = (parcel: CarrierParcel, order: Candidate, clues: MatchClue[], strong: boolean) => {
      used.add(order.id);
      const mapped = parcel.status ? adapter.mapStatus(parcel.status) : null;
      const to: OrderStatus = mapped && mapped !== 'cancelled' ? mapped : 'sent_to_carrier';
      matched.push({
        link: { orderId: order.id, reference: formatReference(prefix, order.number), customerName: order.customerName, from: order.status, to, tracking: parcel.tracking, carrierStatus: parcel.status ?? null, carrierName: carrier.name, clues, strong },
        parcel,
        carrierId: carrier.id,
      });
    };
    const pending: CarrierParcel[] = [];
    for (const parcel of parcels) {
      if (known.has(parcel.tracking)) {
        result.alreadyLinked++;
        continue;
      }
      // Our own reference ("TR-00012") typed at the carrier: certain.
      const refNumber = parcel.reference && new RegExp(`^${prefix}-`, 'i').test(parcel.reference.trim()) ? parseReference(parcel.reference) : null;
      const order = refNumber !== null ? byNumber.get(refNumber) : undefined;
      if (order && !used.has(order.id)) take(parcel, order, ['reference'], true);
      else pending.push(parcel);
    }

    // Best pairs first, so a strong match is never taken by a weaker one.
    const pairs = pending.flatMap((parcel) =>
      candidates.flatMap((order) => {
        const m = score(parcel, order);
        return m && m.score >= MIN_SCORE ? [{ parcel, order, ...m }] : [];
      }),
    );
    pairs.sort((a, b) => b.score - a.score);
    const done = new Set<string>();
    const ambiguous = new Set<string>();
    for (const pair of pairs) {
      if (done.has(pair.parcel.tracking) || used.has(pair.order.id)) continue;
      // Another order fits just as well: the same customer's orders → the latest one
      // before the parcel; a different customer → a real doubt, left to the admin.
      const rivals = pairs.filter((p) => p.parcel === pair.parcel && p.order !== pair.order && p.score === pair.score && !used.has(p.order.id));
      done.add(pair.parcel.tracking);
      if (rivals.some((r) => !r.order.phones.some((ph) => pair.order.phones.includes(ph)))) {
        ambiguous.add(pair.parcel.tracking);
        continue;
      }
      const best = [pair, ...rivals].sort((a, b) => b.order.createdAt.getTime() - a.order.createdAt.getTime())[0]!;
      take(pair.parcel, best.order, best.clues, best.score >= STRONG_SCORE);
    }
    for (const parcel of pending) {
      if (done.has(parcel.tracking) && !ambiguous.has(parcel.tracking)) continue;
      result.unlinked.push({ tracking: parcel.tracking, name: parcel.name, phone: parcel.phones[0] ?? '', status: parcel.status ?? null, createdAt: parcel.createdAt?.toISOString() ?? null, ambiguous: ambiguous.has(parcel.tracking) });
    }
  }
  result.links = matched.map((m) => m.link);
  if (!apply) return result;

  const events: (StatusEvent | null)[] = [];
  // Only the parcels the admin ticked (default: the strong matches).
  const chosen = new Set(only ?? matched.filter((m) => m.link.strong).map((m) => m.link.tracking));
  for (const { link, parcel, carrierId } of matched) {
    if (!chosen.has(link.tracking)) continue;
    await ctx.db.transaction(async (tx) => {
      const [order] = await tx.select().from(orders).where(and(eq(orders.id, link.orderId), isNull(orders.carrierTracking)));
      if (!order) return;
      // These pieces left the shelf before the platform tracked parcels: the
      // stock count already reflects it, so no movement now (a return still
      // puts the pieces back when it is received).
      const patch = {
        carrierId,
        carrierTracking: link.tracking,
        carrierStatus: link.carrierStatus,
        confirmedAt: order.confirmedAt ?? parcel.createdAt ?? new Date(),
        ...(STOCK_OUT_STATUSES.includes(link.to) ? { stockOut: true } : {}),
      };
      await tx.update(orders).set(patch).where(eq(orders.id, order.id));
      Object.assign(order, patch);
      await logEvents(tx, { orderId: order.id, type: 'carrier_update', actorId: user?.id ?? null, data: { event: 'link', carrierStatus: link.carrierStatus, tracking: link.tracking, carrier: link.carrierName } });
      events.push(await transitionStatus(await transitionContext(ctx, tx, user), order, link.to, { meta: { via: 'link' } }));
    });
  }
  emitStatusEvents(ctx, events);
  return result;
}

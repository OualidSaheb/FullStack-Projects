import { and, asc, desc, eq, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import { normalizePhone, STOCK_OUT_STATUSES, type OrderStatus } from '@touraya/shared';
import { formatReference, parseReference, type AppContext } from '../../context';
import { carriers, orderEvents, orders } from '../../db/schema';
import { HttpError } from '../../lib/errors';
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

const fold = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
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

const LATIN = /[a-z]/;
const ARABIC = /[\u0600-\u06ff]/;

/**
 * The carrier's (masked) name against the customer's: "fit" when a word fits or
 * the visible letters are the name's initials ("S****a T*****" → Saliha T…),
 * "clash" when none of them is (same alphabet only: an Arabic name typed in
 * Latin letters at the carrier proves nothing), otherwise no opinion.
 */
function nameVerdict(given: string, name: string): 'fit' | 'clash' | null {
  const plain = fold(name);
  const words = plain.split(/\s+/).filter(Boolean);
  const masked = fold(given).split(/\s+/).filter((w) => w.replace(/[*/]/g, '').length > 0);
  if (!words.length || !masked.length) return null;
  if (masked.some((m) => words.some((w) => (isMasked(m) ? wordFits(m, w) : m === w)))) return 'fit';
  const visible = [...fold(given).replace(/[^\p{L}]/gu, '')];
  if (!visible.length) return null;
  const letters = visible.join('');
  const sameScript = (LATIN.test(letters) && LATIN.test(plain)) || (ARABIC.test(letters) && ARABIC.test(plain));
  if (!sameScript) return null;
  const initials = new Set(words.map((w) => w[0]));
  if (visible.every((c) => initials.has(c))) return 'fit';
  if (!visible.some((c) => initials.has(c))) return 'clash';
  return null;
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
    // Visible letters of another name: another customer, whatever the other clues say.
    const name = parcel.name ? nameVerdict(parcel.name, o.customerName) : null;
    if (name === 'clash') return null;
    if (name === 'fit') {
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

  // Only the parcels the admin ticked (default: the strong matches).
  const chosen = new Set(only ?? matched.filter((m) => m.link.strong).map((m) => m.link.tracking));
  const events: (StatusEvent | null)[] = [];
  for (const { link, parcel, carrierId } of matched) {
    if (chosen.has(link.tracking)) events.push(await linkOrder(ctx, user, { ...link, carrierId, parcelCreatedAt: parcel.createdAt }));
  }
  emitStatusEvents(ctx, events);
  return result;
}

/**
 * Puts a parcel on an order: tracking, the carrier's status, the matching CRM
 * status. These pieces left the shelf before the platform tracked the parcel:
 * the stock count already reflects it, so no movement now (a return still puts
 * the pieces back when it is received).
 */
async function linkOrder(
  ctx: AppContext,
  user: SessionUser | null,
  link: { orderId: string; tracking: string; carrierStatus: string | null; carrierName: string; carrierId: number; to: OrderStatus; parcelCreatedAt: Date | null },
) {
  return ctx.db.transaction(async (tx) => {
    const [order] = await tx.select().from(orders).where(and(eq(orders.id, link.orderId), isNull(orders.carrierTracking)));
    if (!order) return null;
    const patch = {
      carrierId: link.carrierId,
      carrierTracking: link.tracking,
      carrierStatus: link.carrierStatus,
      confirmedAt: order.confirmedAt ?? link.parcelCreatedAt ?? new Date(),
      ...(STOCK_OUT_STATUSES.includes(link.to) ? { stockOut: true } : {}),
    };
    await tx.update(orders).set(patch).where(eq(orders.id, order.id));
    Object.assign(order, patch);
    await logEvents(tx, { orderId: order.id, type: 'carrier_update', actorId: user?.id ?? null, data: { event: 'link', carrierStatus: link.carrierStatus, tracking: link.tracking, carrier: link.carrierName } });
    return transitionStatus(await transitionContext(ctx, tx, user), order, link.to, { meta: { via: 'link' } });
  });
}

/** The admin links one parcel by hand: its tracking number on an order (status read from the carrier). */
export async function linkParcelManually(ctx: AppContext, user: SessionUser | null, input: { tracking: string; reference: string }) {
  const number = parseReference(input.reference);
  const [order] = number === null ? [] : await ctx.db.select().from(orders).where(and(eq(orders.number, number), isNull(orders.deletedAt)));
  if (!order) throw new HttpError(404, 'لا توجد طلبية بهذا الرقم');
  if (order.carrierTracking) throw new HttpError(409, `هذه الطلبية مربوطة من قبل بالطرد ${order.carrierTracking}`);
  const tracking = input.tracking.trim();
  const [taken] = await ctx.db.select({ number: orders.number }).from(orders).where(eq(orders.carrierTracking, tracking));
  if (taken) throw new HttpError(409, `هذا الطرد مربوط من قبل بالطلبية ${formatReference(ctx.config.ORDER_PREFIX, taken.number)}`);

  const rows = await ctx.db.select().from(carriers).where(and(eq(carriers.active, true), eq(carriers.apiEnabled, true)));
  for (const row of rows) {
    const carrier = loadCarrierRow(ctx.secrets, row);
    const adapter = ADAPTERS[carrier.provider];
    const [found] = (await adapter?.fetchStatuses?.(carrier, [tracking])) ?? [];
    if (!adapter || !found) continue;
    const mapped = found.carrierStatus ? adapter.mapStatus(found.carrierStatus) : null;
    const to: OrderStatus = mapped && mapped !== 'cancelled' ? mapped : 'sent_to_carrier';
    const label = found.carrierStatus ? (found.reason ? `${found.carrierStatus} — ${found.reason}` : found.carrierStatus) : null;
    emitStatusEvents(ctx, [await linkOrder(ctx, user, { orderId: order.id, tracking, carrierStatus: label, carrierName: carrier.name, carrierId: carrier.id, to, parcelCreatedAt: null })]);
    return { ok: true, reference: formatReference(ctx.config.ORDER_PREFIX, order.number), status: to };
  }
  throw new HttpError(404, 'لم يُعثر على هذا الطرد عند شركة التوصيل');
}

/**
 * Undoes a link made from the carrier's list (a wrong match): the order goes
 * back to the status it had, without the parcel and without stock movement
 * (linking moved none).
 */
export async function unlinkParcel(ctx: AppContext, user: SessionUser | null, orderId: string) {
  return ctx.db.transaction(async (tx) => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, orderId));
    if (!order?.carrierTracking) throw new HttpError(404, 'هذه الطلبية غير مربوطة بطرد');
    const [linked] = await tx
      .select({ data: orderEvents.data })
      .from(orderEvents)
      .where(and(eq(orderEvents.orderId, orderId), eq(orderEvents.type, 'status_changed'), sql`${orderEvents.data}->>'via' = 'link'`))
      .orderBy(desc(orderEvents.createdAt))
      .limit(1);
    if (!linked) throw new HttpError(409, 'هذا الطرد أُرسل من المنصة نفسها، لا يمكن إلغاء ربطه');
    const back = (linked.data as { from: OrderStatus }).from;
    await tx
      .update(orders)
      .set({ status: back, carrierId: null, carrierTracking: null, carrierStatus: null, stockOut: false, updatedAt: new Date() })
      .where(eq(orders.id, orderId));
    await logEvents(tx, [
      { orderId, type: 'carrier_update', actorId: user?.id ?? null, data: { event: 'unlink', tracking: order.carrierTracking } },
      { orderId, type: 'status_changed', actorId: user?.id ?? null, data: { from: order.status, to: back, via: 'unlink' } },
    ]);
    ctx.events.emit('order.status_changed', [{ orderId, from: order.status, to: back, actorId: user?.id ?? null }]);
    return { ok: true, status: back };
  });
}

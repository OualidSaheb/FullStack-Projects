import { and, asc, eq, isNotNull, isNull, ne } from 'drizzle-orm';
import { normalizePhone, STOCK_OUT_STATUSES, type OrderStatus } from '@touraya/shared';
import type { SessionUser } from '../../lib/auth';
import { formatReference, parseReference, type AppContext } from '../../context';
import { carriers, orders } from '../../db/schema';
import { ADAPTERS } from '../carriers/registry';
import { loadCarrierRow } from '../carriers/service';
import type { CarrierParcel } from '../carriers/types';
import { logEvents } from '../orders/events';
import { emitStatusEvents, transitionContext, type StatusEvent } from '../orders/service';
import { transitionStatus } from '../orders/transitions';

export interface ParcelLink {
  orderId: string;
  reference: string;
  customerName: string;
  from: OrderStatus;
  to: OrderStatus;
  tracking: string;
  carrierStatus: string | null;
  carrierName: string;
  by: 'reference' | 'phone';
}

export interface UnlinkedParcel {
  tracking: string;
  name: string;
  phone: string;
  status: string | null;
  createdAt: string | null;
}

/** A parcel made a little before its order was saved (clock gaps, late sheet sync) still counts. */
const GRACE_MS = 24 * 3600_000;

/**
 * Parcels sent before the platform did it (by hand in the carrier's dashboard,
 * Excel uploads…): found at the carrier and linked to their orders, so their
 * status follows like the others. Matched by our reference when the carrier
 * has it, otherwise by phone: the latest order of that customer made before
 * the parcel, each order linked once. Preview first, then apply.
 */
export async function linkExistingParcels(ctx: AppContext, user: SessionUser | null, apply: boolean) {
  const prefix = ctx.config.ORDER_PREFIX;
  const [oldest] = await ctx.db.select({ at: orders.createdAt }).from(orders).where(isNull(orders.deletedAt)).orderBy(asc(orders.createdAt)).limit(1);
  const result = { links: [] as ParcelLink[], unlinked: [] as UnlinkedParcel[], alreadyLinked: 0, parcels: 0 };
  if (!oldest) return result;

  const known = new Set((await ctx.db.select({ t: orders.carrierTracking }).from(orders).where(isNotNull(orders.carrierTracking))).map((r) => r.t!));
  const candidates = (
    await ctx.db
      .select({ id: orders.id, number: orders.number, customerName: orders.customerName, status: orders.status, createdAt: orders.createdAt, phone: orders.phone, phoneAlt: orders.phoneAlt, phoneCustomer: orders.phoneCustomer, phoneFacebook: orders.phoneFacebook })
      .from(orders)
      .where(and(isNull(orders.deletedAt), isNull(orders.carrierTracking), ne(orders.status, 'cancelled')))
  ).map((o) => ({ ...o, phones: [o.phone, o.phoneAlt, o.phoneCustomer, o.phoneFacebook] }));
  const byNumber = new Map(candidates.map((o) => [o.number, o]));
  const byPhone = new Map<string, typeof candidates>();
  for (const o of candidates) {
    for (const p of new Set(o.phones.map((v) => normalizePhone(v).value).filter(Boolean))) byPhone.set(p, [...(byPhone.get(p) ?? []), o]);
  }
  const used = new Set<string>();

  const rows = await ctx.db.select().from(carriers).where(and(eq(carriers.active, true), eq(carriers.apiEnabled, true)));
  const matched: { link: ParcelLink; parcel: CarrierParcel; carrierId: number }[] = [];
  for (const row of rows) {
    const carrier = loadCarrierRow(ctx.secrets, row);
    const adapter = ADAPTERS[carrier.provider];
    if (!adapter?.listParcels) continue;
    const parcels = (await adapter.listParcels(carrier, new Date(oldest.at.getTime() - GRACE_MS))).sort((a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0));
    result.parcels += parcels.length;
    for (const parcel of parcels) {
      if (known.has(parcel.tracking)) {
        result.alreadyLinked++;
        continue;
      }
      // Our own reference ("TR-00012") typed at the carrier: certain.
      const refNumber = parcel.reference && new RegExp(`^${prefix}-`, 'i').test(parcel.reference.trim()) ? parseReference(parcel.reference) : null;
      let order = refNumber !== null ? byNumber.get(refNumber) : undefined;
      let by: ParcelLink['by'] = 'reference';
      if (!order || used.has(order.id)) {
        by = 'phone';
        const limit = (parcel.createdAt?.getTime() ?? Date.now()) + GRACE_MS;
        order = parcel.phones
          .flatMap((p) => byPhone.get(normalizePhone(p).value) ?? [])
          .filter((o) => !used.has(o.id) && o.createdAt.getTime() <= limit)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
      }
      if (!order) {
        result.unlinked.push({ tracking: parcel.tracking, name: parcel.name, phone: parcel.phones[0] ?? '', status: parcel.status ?? null, createdAt: parcel.createdAt?.toISOString() ?? null });
        continue;
      }
      used.add(order.id);
      const mapped = parcel.status ? adapter.mapStatus(parcel.status) : null;
      const to: OrderStatus = mapped && mapped !== 'cancelled' ? mapped : 'sent_to_carrier';
      const link: ParcelLink = { orderId: order.id, reference: formatReference(prefix, order.number), customerName: order.customerName, from: order.status, to, tracking: parcel.tracking, carrierStatus: parcel.status ?? null, carrierName: carrier.name, by };
      matched.push({ link, parcel, carrierId: carrier.id });
    }
  }
  result.links = matched.map((m) => m.link);
  if (!apply) return result;

  const events: (StatusEvent | null)[] = [];
  for (const { link, parcel, carrierId } of matched) {
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

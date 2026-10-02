import { eq, inArray } from 'drizzle-orm';
import { CALL_ATTEMPT_STATUSES, nextCallAt, STOCK_OUT_STATUSES, type CallPolicy, type OrderStatus } from '@touraya/shared';
import type { DbOrTx } from '../../db/client';
import { orderItems, orders } from '../../db/schema';
import type { DomainEvents } from '../../lib/events';
import { moveOrderStock } from '../inventory/service';
import { logEvents } from './events';

type OrderRow = typeof orders.$inferSelect;
export type ReturnCondition = 'restock' | 'damaged' | 'kept';

export interface TransitionContext {
  db: DbOrTx;
  actor: { id: number; role: string } | null;
  policy: CallPolicy;
  prefix: string;
}

export interface TransitionOptions {
  callAt?: Date;
  cancelReason?: string;
  /** For return_received: put the pieces back on the shelf or write them off (whole parcel)… */
  returnCondition?: 'restock' | 'damaged';
  /** …or piece by piece: item id → restock | damaged | kept (customer kept it / lost). */
  returnItems?: Record<number, ReturnCondition>;
  /** Free data stored on the status_changed event (e.g. { via: 'yalidine' }). */
  meta?: Record<string, unknown>;
}

const NO_ANSWER_REASON = 'لا يرد بعد كل المحاولات';

/**
 * The single path for every status change (agent, bulk, export, carrier API,
 * webhook). Keeps the derived state consistent in one place:
 * attempts counter, next call time, confirmation stamp, ownership, queue lock,
 * cancel reason, stock out/in, activity log. Returns the event to emit after commit.
 */
export async function transitionStatus(
  t: TransitionContext,
  order: OrderRow,
  requested: OrderStatus,
  opts: TransitionOptions = {},
): Promise<DomainEvents['order.status_changed'] | null> {
  let to = requested;
  const attempt = CALL_ATTEMPT_STATUSES.indexOf(to) + 1;
  let cancelReason = opts.cancelReason;
  if (attempt > 0 && attempt >= t.policy.maxAttempts && t.policy.autoCancelAfterMax) {
    to = 'cancelled';
    cancelReason ??= NO_ANSWER_REASON;
  }
  const from = order.status;
  if (from === to) return null;

  const now = new Date();
  const patch: Partial<OrderRow> = { status: to, updatedAt: now, lockedById: null, lockedUntil: null };
  if (attempt > 0) patch.callAttempts = attempt;
  patch.nextCallAt = attempt > 0 && to !== 'cancelled' ? nextCallAt(now, attempt, t.policy) : to === 'postponed' ? opts.callAt ?? new Date(now.getTime() + 3600_000) : null;
  if (to === 'confirmed') Object.assign(patch, { confirmedById: t.actor?.id ?? null, confirmedAt: now });
  patch.cancelReason = to === 'cancelled' ? cancelReason ?? null : null;
  // The first agent who works an unassigned order owns it (drives per-agent stats).
  if (order.assignedToId === null && t.actor?.role === 'agent') patch.assignedToId = t.actor.id;

  // Stock follows the physical goods.
  const actorId = t.actor?.id ?? null;
  const goesOut = STOCK_OUT_STATUSES.includes(to);
  if (goesOut && !order.stockOut) {
    await moveOrderStock(t.db, order, 'ship', -1, actorId, t.prefix);
    patch.stockOut = true;
  } else if (to === 'return_received' && order.stockOut) {
    await receivePieces(t, order, opts, actorId);
    patch.stockOut = false;
  } else if (!goesOut && order.stockOut) {
    // Status corrected back (e.g. export undone): the pieces never left.
    await moveOrderStock(t.db, order, 'ship_reversal', 1, actorId, t.prefix);
    patch.stockOut = false;
  }

  await t.db.update(orders).set(patch).where(eq(orders.id, order.id));
  await logEvents(t.db, {
    orderId: order.id,
    type: 'status_changed',
    actorId,
    data: { from, to, ...(patch.cancelReason ? { reason: patch.cancelReason } : {}), ...(opts.returnCondition ? { condition: opts.returnCondition } : {}), ...opts.meta },
  });
  Object.assign(order, patch);
  return { orderId: order.id, from, to, actorId };
}

/**
 * A returned parcel is checked in: restocked pieces go back on the shelf,
 * damaged ones are booked in and written off (so the ledger shows the loss),
 * kept/lost ones never come back. Each piece remembers its outcome.
 */
async function receivePieces(t: TransitionContext, order: OrderRow, opts: TransitionOptions, actorId: number | null) {
  const items = await t.db.select({ id: orderItems.id }).from(orderItems).where(eq(orderItems.orderId, order.id));
  const conditionOf = (id: number): ReturnCondition => opts.returnItems?.[id] ?? opts.returnCondition ?? 'restock';
  const ids = (c: ReturnCondition) => items.filter((i) => conditionOf(i.id) === c).map((i) => i.id);
  const back = [...ids('restock'), ...ids('damaged')];
  if (back.length) await moveOrderStock(t.db, order, 'return', 1, actorId, t.prefix, back);
  if (ids('damaged').length) await moveOrderStock(t.db, order, 'damaged', -1, actorId, t.prefix, ids('damaged'));
  for (const c of ['restock', 'damaged', 'kept'] as const) {
    if (ids(c).length) await t.db.update(orderItems).set({ returnCondition: c }).where(inArray(orderItems.id, ids(c)));
  }
}

import type { OrderEventType } from '@touraya/shared';
import type { DbOrTx } from '../../db/client';
import { orderEvents } from '../../db/schema';

export interface EventInput {
  orderId: string;
  type: OrderEventType;
  actorId?: number | null;
  data?: Record<string, unknown>;
}

/** Appends to the order activity log. Accepts one or many events (bulk actions). */
export async function logEvents(db: DbOrTx, events: EventInput | EventInput[]) {
  const list = Array.isArray(events) ? events : [events];
  if (!list.length) return;
  await db.insert(orderEvents).values(
    list.map((e) => ({ orderId: e.orderId, type: e.type, actorId: e.actorId ?? null, data: e.data ?? {} })),
  );
}

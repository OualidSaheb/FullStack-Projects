import { and, ne, sql } from 'drizzle-orm';
import type { AppContext } from '../../context';
import { orders } from '../../db/schema';
import type { SessionUser } from '../../lib/auth';
import { dueForUser } from './query';

const LOCK_MINUTES = 10;

/**
 * Hands the agent the next order to call and locks it for a few minutes so two
 * agents never call the same customer. The order the agent already holds comes
 * back first; then oldest due (callbacks at their time, new orders in arrival
 * order). Safe under concurrency (SKIP LOCKED).
 */
export async function claimNextOrder(ctx: AppContext, user: SessionUser, excludeId?: string): Promise<string | null> {
  const candidate = ctx.db
    .select({ id: orders.id })
    .from(orders)
    .where(and(dueForUser(user.id), excludeId ? ne(orders.id, excludeId) : undefined))
    .orderBy(sql`(${orders.lockedById} = ${user.id} and ${orders.lockedUntil} > now()) is true desc`, sql`coalesce(${orders.nextCallAt}, ${orders.createdAt})`, orders.number)
    .limit(1)
    .for('update', { skipLocked: true });

  const [row] = await ctx.db
    .update(orders)
    .set({
      lockedById: user.id,
      lockedUntil: sql`now() + make_interval(mins => ${LOCK_MINUTES})`,
      assignedToId: sql`coalesce(${orders.assignedToId}, ${user.role === 'agent' ? user.id : null})`,
    })
    .where(sql`${orders.id} = (${candidate})`)
    .returning({ id: orders.id });
  return row?.id ?? null;
}

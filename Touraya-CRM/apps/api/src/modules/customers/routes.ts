import type { FastifyPluginAsync } from 'fastify';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { blacklistSchema } from '@touraya/shared';
import { formatReference } from '../../context';
import { customers, orders } from '../../db/schema';
import { notFound } from '../../lib/errors';

const idParams = z.object({ id: z.coerce.number().int() });

export const customerRoutes: FastifyPluginAsync = async (app) => {
  /** Customer card: all orders of this phone number across offers and carriers. */
  app.get('/customers/:id', { preHandler: app.requirePermission('orders.view') }, async (req) => {
    const { id } = idParams.parse(req.params);
    const [customer] = await app.db.select().from(customers).where(eq(customers.id, id));
    if (!customer) throw notFound();
    const list = await app.db
      .select({ id: orders.id, number: orders.number, status: orders.status, price: orders.price, createdAt: orders.createdAt, deletedAt: orders.deletedAt })
      .from(orders)
      .where(eq(orders.customerId, id))
      .orderBy(desc(orders.createdAt));
    return {
      ...customer,
      createdAt: customer.createdAt.toISOString(),
      orders: list.map(({ number, createdAt, deletedAt, ...o }) => ({
        ...o,
        reference: formatReference(app.config.ORDER_PREFIX, number),
        createdAt: createdAt.toISOString(),
        deleted: Boolean(deletedAt),
      })),
    };
  });

  app.put('/customers/:id/blacklist', { preHandler: app.requirePermission('customers.blacklist') }, async (req) => {
    const { id } = idParams.parse(req.params);
    const { blacklisted, reason } = blacklistSchema.parse(req.body);
    const [row] = await app.db
      .update(customers)
      .set({ blacklisted, blacklistReason: blacklisted ? reason ?? null : null })
      .where(eq(customers.id, id))
      .returning({ id: customers.id });
    if (!row) throw notFound();
    return { ok: true };
  });
};

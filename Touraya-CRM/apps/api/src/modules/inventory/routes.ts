import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { stockMovementSchema } from '@touraya/shared';
import { listMovements, moveStock } from './service';

export const inventoryRoutes: FastifyPluginAsync = async (app) => {
  app.get('/inventory/movements', { preHandler: app.requirePermission('inventory.view') }, async (req) => {
    const { variantId } = z.object({ variantId: z.coerce.number().int().optional() }).parse(req.query);
    return listMovements(app.db, app.config.ORDER_PREFIX, { variantIds: variantId ? [variantId] : undefined });
  });

  /** Goods received, inventory count correction, damaged goods. */
  app.post('/inventory/movements', { preHandler: app.requirePermission('inventory.manage') }, async (req) => {
    const input = stockMovementSchema.parse(req.body);
    const quantity = input.type === 'damaged' ? -Math.abs(input.quantity) : input.type === 'purchase' ? Math.abs(input.quantity) : input.quantity;
    await app.db.transaction((tx) => moveStock(tx, [{ ...input, quantity, actorId: req.user.id }]));
    return { ok: true };
  });
};

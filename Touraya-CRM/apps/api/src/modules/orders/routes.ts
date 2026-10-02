import type { FastifyPluginAsync } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  bulkActionSchema,
  commentSchema,
  deleteByFilterSchema,
  orderFilterSchema,
  orderListQuerySchema,
  orderUpdateSchema,
  returnReceiveSchema,
  statusChangeSchema,
} from '@touraya/shared';
import { orders } from '../../db/schema';
import { assertCan } from '../../lib/auth';
import { conflict } from '../../lib/errors';
import { countByStatus, idsForFilter, listOrders } from './query';
import { claimNextOrder } from './queue';
import { addComment, bulkAction, changeStatus, getOrderDetail, getTimeline, receiveReturn, updateOrder } from './service';

const idParams = z.object({ id: z.string().uuid() });

export const orderRoutes: FastifyPluginAsync = async (app) => {
  const view = { preHandler: app.requirePermission('orders.view') };

  app.get('/orders', view, async (req) => listOrders(app.db, orderListQuerySchema.parse(req.query), req.user, app.config.ORDER_PREFIX));

  app.get('/orders/counts', view, async (req) => countByStatus(app.db, orderFilterSchema.parse(req.query), req.user));

  /** Work mode: claim the next order to call (locked for this agent for a few minutes). */
  app.post('/orders/queue/next', view, async (req) => {
    assertCan(req.user, 'orders.status');
    const { exclude } = z.object({ exclude: z.string().uuid().optional() }).parse(req.body ?? {});
    return { id: await claimNextOrder(app, req.user, exclude) };
  });

  app.get('/orders/:id', view, async (req) => getOrderDetail(app, idParams.parse(req.params).id));

  app.get('/orders/:id/timeline', view, async (req) => getTimeline(app.db, idParams.parse(req.params).id));

  app.patch('/orders/:id', view, async (req) => updateOrder(app, idParams.parse(req.params).id, orderUpdateSchema.parse(req.body), req.user));

  app.post('/orders/:id/status', view, async (req) => changeStatus(app, idParams.parse(req.params).id, statusChangeSchema.parse(req.body), req.user));

  /** Agent leaves the order without an outcome: free it for colleagues. */
  app.post('/orders/:id/release', view, async (req) => {
    const { id } = idParams.parse(req.params);
    await app.db.update(orders).set({ lockedById: null, lockedUntil: null }).where(and(eq(orders.id, id), eq(orders.lockedById, req.user.id)));
    return { ok: true };
  });

  app.post('/orders/:id/comments', view, async (req) => {
    assertCan(req.user, 'orders.comment');
    return addComment(app, idParams.parse(req.params).id, commentSchema.parse(req.body).body, req.user);
  });

  app.post('/orders/:id/return-received', { preHandler: app.requirePermission('returns.manage') }, async (req) => {
    const { condition, note } = returnReceiveSchema.parse(req.body);
    return receiveReturn(app, idParams.parse(req.params).id, condition, note, req.user);
  });

  app.post('/orders/bulk', view, async (req) => bulkAction(app, bulkActionSchema.parse(req.body), req.user));

  /** Soft-delete everything matching a filter. The client sends the count it showed the user as a safety check. */
  app.post('/orders/delete-by-filter', { preHandler: app.requirePermission('orders.delete') }, async (req) => {
    const { filter, confirmCount } = deleteByFilterSchema.parse(req.body);
    const ids = await idsForFilter(app.db, { ...filter, deleted: false }, req.user);
    if (ids.length !== confirmCount) throw conflict('تغير عدد الطلبيات، أعد المحاولة', { expected: confirmCount, actual: ids.length });
    let affected = 0;
    for (let i = 0; i < ids.length; i += 1000) affected += (await bulkAction(app, { action: 'delete', ids: ids.slice(i, i + 1000) }, req.user)).affected;
    return { affected };
  });
};

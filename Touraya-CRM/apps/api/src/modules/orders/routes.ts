import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  bulkActionSchema,
  commentSchema,
  deleteByFilterSchema,
  orderFilterSchema,
  orderListQuerySchema,
  orderUpdateSchema,
  statusChangeSchema,
} from '@touraya/shared';
import { assertCan } from '../../lib/auth';
import { conflict } from '../../lib/errors';
import { countByStatus, idsForFilter, listOrders } from './query';
import { addComment, bulkAction, changeStatus, getOrderDetail, getTimeline, oldestNewOrderId, updateOrder } from './service';

const idParams = z.object({ id: z.string().uuid() });

export const orderRoutes: FastifyPluginAsync = async (app) => {
  const view = { preHandler: app.requirePermission('orders.view') };

  app.get('/orders', view, async (req) =>
    listOrders(app.db, orderListQuerySchema.parse(req.query), req.user, app.config.ORDER_PREFIX),
  );

  app.get('/orders/counts', view, async (req) => countByStatus(app.db, orderFilterSchema.parse(req.query), req.user));

  app.get('/orders/next', view, async () => ({ id: await oldestNewOrderId(app.db) }));

  app.get('/orders/:id', view, async (req) => getOrderDetail(app, idParams.parse(req.params).id));

  app.get('/orders/:id/timeline', view, async (req) => getTimeline(app.db, idParams.parse(req.params).id));

  app.patch('/orders/:id', view, async (req) =>
    updateOrder(app, idParams.parse(req.params).id, orderUpdateSchema.parse(req.body), req.user),
  );

  app.post('/orders/:id/status', view, async (req) =>
    changeStatus(app, idParams.parse(req.params).id, statusChangeSchema.parse(req.body), req.user),
  );

  app.post('/orders/:id/comments', view, async (req) => {
    assertCan(req.user, 'orders.comment');
    return addComment(app, idParams.parse(req.params).id, commentSchema.parse(req.body).body, req.user);
  });

  app.post('/orders/bulk', view, async (req) => bulkAction(app, bulkActionSchema.parse(req.body), req.user));

  /** Soft-delete everything matching a filter. The client sends the count it showed the user as a safety check. */
  app.post('/orders/delete-by-filter', { preHandler: app.requirePermission('orders.delete') }, async (req) => {
    const { filter, confirmCount } = deleteByFilterSchema.parse(req.body);
    const ids = await idsForFilter(app.db, { ...filter, deleted: false }, req.user);
    if (ids.length !== confirmCount) throw conflict('تغير عدد الطلبيات، أعد المحاولة', { expected: confirmCount, actual: ids.length });
    return bulkAction(app, { action: 'delete', ids }, req.user);
  });
};

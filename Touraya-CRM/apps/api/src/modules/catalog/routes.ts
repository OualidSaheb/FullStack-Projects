import type { FastifyPluginAsync } from 'fastify';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { offerSchema, productOptionsSchema, productSchema } from '@touraya/shared';
import { offers, products } from '../../db/schema';
import { notFound } from '../../lib/errors';
import { addProductOptions, listProducts, saveProduct, toOfferDTO } from './service';

const idParams = z.object({ id: z.coerce.number().int() });

export const catalogRoutes: FastifyPluginAsync = async (app) => {
  const manage = { preHandler: app.requirePermission('products.manage') };

  app.get('/products', { preHandler: app.requireAuth }, async () => listProducts(app.db));

  app.post('/products', manage, async (req) => {
    await app.db.transaction((tx) => saveProduct(tx, productSchema.parse(req.body), undefined, req.user.id));
    return listProducts(app.db);
  });

  app.put('/products/:id', manage, async (req) => {
    const { id } = idParams.parse(req.params);
    const row = await app.db.transaction((tx) => saveProduct(tx, productSchema.parse(req.body), id, req.user.id));
    if (!row) throw notFound();
    return listProducts(app.db);
  });

  /**
   * Add a size or color while on the phone with a customer ("he wants green").
   * Agents can do it: it only creates empty stock slots, never changes prices.
   */
  app.post('/products/:id/options', { preHandler: app.requirePermission('orders.edit') }, async (req) => {
    const { id } = idParams.parse(req.params);
    const row = await app.db.transaction((tx) => addProductOptions(tx, id, productOptionsSchema.parse(req.body)));
    if (!row) throw notFound();
    return listProducts(app.db);
  });

  app.get('/offers', { preHandler: app.requireAuth }, async () =>
    (await app.db.select().from(offers).where(isNull(offers.deletedAt)).orderBy(asc(offers.id))).map(toOfferDTO),
  );

  app.post('/offers', manage, async (req) => {
    const [o] = await app.db.insert(offers).values(offerSchema.parse(req.body)).returning();
    return toOfferDTO(o!);
  });

  app.put('/offers/:id', manage, async (req) => {
    const { id } = idParams.parse(req.params);
    const [o] = await app.db.update(offers).set({ ...offerSchema.parse(req.body), updatedAt: new Date() }).where(eq(offers.id, id)).returning();
    if (!o) throw notFound();
    return toOfferDTO(o);
  });
  /**
   * Removing a product or an offer archives it: it disappears from the lists,
   * forms and new orders, while past orders, stock history and statistics keep it.
   */
  app.delete('/offers/:id', manage, async (req) => {
    const { id } = idParams.parse(req.params);
    const [o] = await app.db
      .update(offers)
      .set({ deletedAt: new Date(), active: false })
      .where(and(eq(offers.id, id), isNull(offers.deletedAt)))
      .returning({ id: offers.id });
    if (!o) throw notFound();
    return { ok: true };
  });

  app.delete('/products/:id', manage, async (req) => {
    const { id } = idParams.parse(req.params);
    await app.db.transaction(async (tx) => {
      const [p] = await tx
        .update(products)
        .set({ deletedAt: new Date(), active: false })
        .where(and(eq(products.id, id), isNull(products.deletedAt)))
        .returning({ id: products.id });
      if (!p) throw notFound();
      await tx.update(offers).set({ deletedAt: new Date(), active: false }).where(and(eq(offers.productId, id), isNull(offers.deletedAt)));
    });
    return { ok: true };
  });
};
